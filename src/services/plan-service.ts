import { Op, type Transaction } from 'sequelize';
import { sequelize } from '../database';
import { AppError, conflict, notFound } from '../errors/app-error';
import { Asset, Plan, Scene } from '../models';
import type { JsonObject, PlanCoordinateSystem } from '../models/model.types';
import { requireProjectRole } from './access-service';
import { sanitizeRequiredPlainText } from './content-service';
import { bumpProjectRevision, getAccessibleProject } from './project-service';

export type PlanInput = {
  projectRevision: number;
  name?: string;
  assetId?: string | null;
  coordinateSystem?: PlanCoordinateSystem;
  metadata?: Record<string, unknown>;
};

export function planPayload(plan: Plan): Record<string, unknown> {
  return {
    id: plan.id,
    projectId: plan.projectId,
    name: plan.name,
    assetId: plan.assetId,
    coordinateSystem: plan.coordinateSystem,
    metadata: plan.metadata,
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt
  };
}

/**
 * A plan image is an ordinary logical asset. Accepting `image` as well as
 * `plan_image` keeps the creator flow simple: uploading a floor plan through
 * the normal image path still works.
 */
async function assertPlanAsset(
  assetId: string | null | undefined,
  projectId: string,
  ownerId: string,
  transaction: Transaction
): Promise<void> {
  if (!assetId) return;
  const asset = await Asset.findOne({
    where: {
      id: assetId,
      ownerId,
      mediaType: { [Op.in]: ['plan_image', 'image'] },
      [Op.or]: [{ projectId }, { projectId: null }]
    },
    transaction,
    lock: transaction.LOCK.KEY_SHARE
  });
  if (!asset) {
    throw new AppError('INVALID_ASSET_REFERENCE', 'The plan image is not available to this project.', {
      status: 422,
      entityId: assetId,
      path: 'assetId'
    });
  }
}

export async function listPlans(
  projectId: string,
  userId: string
): Promise<Record<string, unknown>[]> {
  await requireProjectRole(projectId, userId, 'viewer');
  const plans = await Plan.findAll({
    where: { projectId },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']]
  });
  return plans.map(planPayload);
}

export async function createPlan(
  projectId: string,
  userId: string,
  input: PlanInput & { name: string }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, userId, 'editor', transaction);
    if (project.type !== 'image360') {
      throw new AppError('PROJECT_TYPE_MISMATCH', 'Plans are only available on 360 image experiences.', {
        status: 422,
        entityId: projectId,
        path: 'type'
      });
    }
    await assertPlanAsset(input.assetId, projectId, project.ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    const existing = await Plan.count({ where: { projectId }, transaction });
    const plan = await Plan.create(
      {
        projectId,
        name: sanitizeRequiredPlainText(input.name, 'name'),
        assetId: input.assetId ?? null,
        coordinateSystem: input.coordinateSystem ?? 'plan_normalized',
        metadata: (input.metadata ?? {}) as JsonObject,
        sortOrder: existing
      },
      { transaction }
    );
    return { plan: planPayload(plan), projectRevision: revision };
  });
}

export async function updatePlan(
  projectId: string,
  planId: string,
  userId: string,
  input: PlanInput
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, userId, 'editor', transaction);
    const plan = await Plan.findOne({ where: { id: planId, projectId }, transaction });
    if (!plan) throw notFound('plan', planId);
    await assertPlanAsset(input.assetId, projectId, project.ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    await plan.update(
      {
        ...(input.name === undefined
          ? {}
          : { name: sanitizeRequiredPlainText(input.name, 'name') }),
        ...(input.assetId === undefined ? {} : { assetId: input.assetId }),
        ...(input.coordinateSystem === undefined
          ? {}
          : { coordinateSystem: input.coordinateSystem }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata as JsonObject })
      },
      { transaction }
    );
    return { plan: planPayload(plan), projectRevision: revision };
  });
}

/** A plan with scenes placed on it is never silently detached from them. */
export async function deletePlan(
  projectId: string,
  planId: string,
  userId: string,
  projectRevision: number
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getAccessibleProject(projectId, userId, 'editor', transaction);
    const plan = await Plan.findOne({ where: { id: planId, projectId }, transaction });
    if (!plan) throw notFound('plan', planId);
    const scenes = await Scene.findAll({
      where: { projectId },
      attributes: ['id', 'name', 'spatialData'],
      transaction
    });
    const placedScenes = scenes.filter((scene) => scene.spatialData.planId === planId);
    if (placedScenes.length > 0) {
      throw conflict('PLAN_IN_USE', 'Remove the listed scenes from this plan before deleting it.', {
        planId,
        references: placedScenes.map((scene) => ({
          type: 'scenePlacement',
          id: scene.id,
          name: scene.name,
          path: 'spatialData.planId'
        }))
      });
    }
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: projectRevision,
      transaction
    });
    await plan.destroy({ transaction });
    const remaining = await Plan.findAll({
      where: { projectId },
      order: [['sortOrder', 'ASC'], ['id', 'ASC']],
      transaction
    });
    for (const [sortOrder, remainingPlan] of remaining.entries()) {
      if (remainingPlan.sortOrder !== sortOrder) {
        await remainingPlan.update({ sortOrder }, { transaction });
      }
    }
    return { deleted: true, planId, projectRevision: revision };
  });
}

export async function reorderPlans(
  projectId: string,
  userId: string,
  input: { projectRevision: number; planIds: string[] }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getAccessibleProject(projectId, userId, 'editor', transaction);
    const plans = await Plan.findAll({
      where: { projectId },
      order: [['sortOrder', 'ASC'], ['id', 'ASC']],
      transaction
    });
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const requested = new Set(input.planIds);
    if (input.planIds.length !== plans.length
      || requested.size !== input.planIds.length
      || input.planIds.some((planId) => !planById.has(planId))) {
      throw new AppError('INVALID_PLAN_ORDER', 'The plan order must include every plan exactly once.', {
        status: 422,
        path: 'planIds'
      });
    }
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    for (const [sortOrder, planId] of input.planIds.entries()) {
      const plan = planById.get(planId)!;
      if (plan.sortOrder !== sortOrder) await plan.update({ sortOrder }, { transaction });
    }
    const ordered = input.planIds.map((planId) => planById.get(planId)!);
    return { plans: ordered.map(planPayload), projectRevision: revision };
  });
}
