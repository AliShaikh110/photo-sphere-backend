import { Op, type Transaction } from 'sequelize';
import { AppError, notFound } from '../errors/app-error';
import {
  Project,
  ProjectAccess,
  User,
  Workspace,
  WorkspaceMembership
} from '../models';
import { ACCESS_ROLES } from '../models/model.types';
import type { AccessRole, JsonObject } from '../models/model.types';
import { sanitizeRequiredPlainText } from './content-service';
import { recordAudit } from './audit-service';

const ROLE_RANK: Readonly<Record<AccessRole, number>> = Object.freeze({
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3
});

export type ProjectAccessDecision = {
  readonly projectId: string;
  readonly ownerId: string;
  readonly workspaceId: string | null;
  readonly role: AccessRole;
  readonly source: 'owner' | 'project-grant' | 'workspace-membership';
};

export function roleAtLeast(role: AccessRole, required: AccessRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

function higherRole(left: AccessRole, right: AccessRole): AccessRole {
  return ROLE_RANK[left] >= ROLE_RANK[right] ? left : right;
}

/**
 * The single authorization decision for a project. Ownership, workspace
 * membership and per-project grants are combined here so no route has to
 * reimplement the rules, and the most privileged applicable role wins.
 */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
  transaction?: Transaction
): Promise<ProjectAccessDecision> {
  const project = await Project.findByPk(projectId, {
    attributes: ['id', 'ownerId', 'workspaceId'],
    ...(transaction === undefined ? {} : { transaction })
  });
  if (!project) throw notFound('project', projectId);

  if (project.ownerId === userId) {
    return {
      projectId: project.id,
      ownerId: project.ownerId,
      workspaceId: project.workspaceId ?? null,
      role: 'owner',
      source: 'owner'
    };
  }

  let role: AccessRole | undefined;
  let source: ProjectAccessDecision['source'] | undefined;

  if (project.workspaceId) {
    const membership = await WorkspaceMembership.findOne({
      where: { workspaceId: project.workspaceId, userId, status: 'active' },
      attributes: ['role'],
      ...(transaction === undefined ? {} : { transaction })
    });
    if (membership) {
      role = membership.role;
      source = 'workspace-membership';
    }
  }

  const grant = await ProjectAccess.findOne({
    where: { projectId, userId },
    attributes: ['role'],
    ...(transaction === undefined ? {} : { transaction })
  });
  if (grant) {
    role = role === undefined ? grant.role : higherRole(role, grant.role);
    if (role === grant.role) source = 'project-grant';
  }

  if (role === undefined || source === undefined) {
    // Same shape as an unknown project: access is not a discovery oracle.
    throw notFound('project', projectId);
  }

  return {
    projectId: project.id,
    ownerId: project.ownerId,
    workspaceId: project.workspaceId ?? null,
    role,
    source
  };
}

/** Resolves access and enforces a minimum role in one call. */
export async function requireProjectRole(
  projectId: string,
  userId: string,
  required: AccessRole,
  transaction?: Transaction
): Promise<ProjectAccessDecision> {
  const decision = await resolveProjectAccess(projectId, userId, transaction);
  if (!roleAtLeast(decision.role, required)) {
    throw new AppError('PROJECT_ACCESS_DENIED', 'You do not have permission to do that.', {
      status: 403,
      entityId: projectId,
      details: { requiredRole: required, role: decision.role }
    });
  }
  return decision;
}

/** Project IDs a user can read: owned, workspace-visible, or explicitly granted. */
export async function accessibleProjectFilter(userId: string): Promise<Record<symbol | string, unknown>> {
  const memberships = await WorkspaceMembership.findAll({
    where: { userId, status: 'active' },
    attributes: ['workspaceId']
  });
  const grants = await ProjectAccess.findAll({
    where: { userId },
    attributes: ['projectId']
  });
  const workspaceIds = memberships.map((membership) => membership.workspaceId);
  const projectIds = grants.map((grant) => grant.projectId);
  return {
    [Op.or]: [
      { ownerId: userId },
      ...(workspaceIds.length === 0 ? [] : [{ workspaceId: { [Op.in]: workspaceIds } }]),
      ...(projectIds.length === 0 ? [] : [{ id: { [Op.in]: projectIds } }])
    ]
  };
}

export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  required: AccessRole
): Promise<{ workspace: Workspace; role: AccessRole }> {
  const workspace = await Workspace.findByPk(workspaceId);
  if (!workspace) throw notFound('workspace', workspaceId);
  if (workspace.ownerId === userId) return { workspace, role: 'owner' };
  const membership = await WorkspaceMembership.findOne({
    where: { workspaceId, userId, status: 'active' }
  });
  if (!membership) throw notFound('workspace', workspaceId);
  if (!roleAtLeast(membership.role, required)) {
    throw new AppError('WORKSPACE_ACCESS_DENIED', 'You do not have permission to do that.', {
      status: 403,
      entityId: workspaceId,
      details: { requiredRole: required, role: membership.role }
    });
  }
  return { workspace, role: membership.role };
}

function workspacePayload(workspace: Workspace, role: AccessRole): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role,
    settings: workspace.settings,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  };
}

export async function listWorkspaces(userId: string): Promise<Record<string, unknown>[]> {
  const owned = await Workspace.findAll({ where: { ownerId: userId }, order: [['name', 'ASC']] });
  const memberships = await WorkspaceMembership.findAll({
    where: { userId, status: 'active' },
    include: [{ model: Workspace, as: 'workspace', required: true }]
  });
  const seen = new Set(owned.map((workspace) => workspace.id));
  return [
    ...owned.map((workspace) => workspacePayload(workspace, 'owner')),
    ...memberships
      .filter((membership) => membership.workspace && !seen.has(membership.workspaceId))
      .map((membership) => workspacePayload(membership.workspace!, membership.role))
  ];
}

export async function createWorkspace(
  userId: string,
  input: { name: string; slug: string }
): Promise<Record<string, unknown>> {
  const existing = await Workspace.findOne({ where: { slug: input.slug }, attributes: ['id'] });
  if (existing) {
    throw new AppError('WORKSPACE_SLUG_EXISTS', 'That workspace address is already in use.', {
      status: 409,
      path: 'slug'
    });
  }
  const workspace = await Workspace.create({
    ownerId: userId,
    name: sanitizeRequiredPlainText(input.name, 'name'),
    slug: input.slug,
    settings: {} as JsonObject
  });
  // The owner is also an explicit member, so listings and role changes have a
  // single source of truth.
  await WorkspaceMembership.create({
    workspaceId: workspace.id,
    userId,
    role: 'owner',
    status: 'active',
    invitedByUserId: userId,
    acceptedAt: new Date()
  });
  return workspacePayload(workspace, 'owner');
}

export async function listWorkspaceMembers(
  workspaceId: string,
  userId: string
): Promise<Record<string, unknown>[]> {
  await requireWorkspaceRole(workspaceId, userId, 'viewer');
  const memberships = await WorkspaceMembership.findAll({
    where: { workspaceId },
    include: [{ model: User, as: 'user', attributes: ['id', 'email', 'displayName'] }],
    order: [['createdAt', 'ASC']]
  });
  return memberships.map((membership) => ({
    id: membership.id,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    invitedAt: membership.invitedAt,
    acceptedAt: membership.acceptedAt,
    ...(membership.user
      ? { email: membership.user.email, displayName: membership.user.displayName }
      : {})
  }));
}

export async function inviteWorkspaceMember(
  workspaceId: string,
  actorUserId: string,
  input: { email: string; role: AccessRole }
): Promise<Record<string, unknown>> {
  await requireWorkspaceRole(workspaceId, actorUserId, 'admin');
  if (input.role === 'owner') {
    throw new AppError('ROLE_NOT_ASSIGNABLE', 'Ownership is transferred, not invited.', {
      status: 422,
      path: 'role'
    });
  }
  const user = await User.findOne({ where: { email: input.email }, attributes: ['id'] });
  if (!user) {
    // Do not disclose whether an address has an account.
    throw new AppError('INVITE_NOT_DELIVERABLE', 'That person cannot be invited yet.', {
      status: 422,
      path: 'email'
    });
  }
  const existing = await WorkspaceMembership.findOne({ where: { workspaceId, userId: user.id } });
  const membership = existing
    ? await existing.update({ role: input.role, status: 'invited', invitedByUserId: actorUserId })
    : await WorkspaceMembership.create({
      workspaceId,
      userId: user.id,
      role: input.role,
      status: 'invited',
      invitedByUserId: actorUserId,
      acceptedAt: null
    });
  await recordAudit({
    action: 'workspace.member_invited',
    actorUserId,
    workspaceId,
    entityType: 'membership',
    entityId: membership.id,
    metadata: { role: input.role }
  });
  return { id: membership.id, userId: membership.userId, role: membership.role, status: membership.status };
}

export async function acceptWorkspaceInvite(
  workspaceId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const membership = await WorkspaceMembership.findOne({
    where: { workspaceId, userId, status: 'invited' }
  });
  if (!membership) throw notFound('workspace invitation', workspaceId);
  await membership.update({ status: 'active', acceptedAt: new Date() });
  return { id: membership.id, workspaceId, role: membership.role, status: membership.status };
}

export async function changeWorkspaceMemberRole(
  workspaceId: string,
  actorUserId: string,
  membershipId: string,
  role: AccessRole
): Promise<Record<string, unknown>> {
  const { workspace } = await requireWorkspaceRole(workspaceId, actorUserId, 'admin');
  const membership = await WorkspaceMembership.findOne({ where: { id: membershipId, workspaceId } });
  if (!membership) throw notFound('membership', membershipId);
  if (membership.userId === workspace.ownerId) {
    throw new AppError('ROLE_NOT_ASSIGNABLE', 'The workspace owner keeps the owner role.', {
      status: 422,
      entityId: membershipId,
      path: 'role'
    });
  }
  const previousRole = membership.role;
  await membership.update({ role });
  await recordAudit({
    action: 'workspace.member_role_changed',
    actorUserId,
    workspaceId,
    entityType: 'membership',
    entityId: membershipId,
    metadata: { previousRole, role }
  });
  return { id: membership.id, userId: membership.userId, role: membership.role, status: membership.status };
}

export async function removeWorkspaceMember(
  workspaceId: string,
  actorUserId: string,
  membershipId: string
): Promise<Record<string, unknown>> {
  const { workspace } = await requireWorkspaceRole(workspaceId, actorUserId, 'admin');
  const membership = await WorkspaceMembership.findOne({ where: { id: membershipId, workspaceId } });
  if (!membership) throw notFound('membership', membershipId);
  if (membership.userId === workspace.ownerId) {
    throw new AppError('MEMBER_NOT_REMOVABLE', 'The workspace owner cannot be removed.', {
      status: 422,
      entityId: membershipId
    });
  }
  await membership.update({ status: 'revoked' });
  await recordAudit({
    action: 'workspace.member_removed',
    actorUserId,
    workspaceId,
    entityType: 'membership',
    entityId: membershipId,
    metadata: { role: membership.role }
  });
  return { removed: true, membershipId };
}

export async function listProjectAccess(
  projectId: string,
  userId: string
): Promise<Record<string, unknown>[]> {
  await requireProjectRole(projectId, userId, 'admin');
  const grants = await ProjectAccess.findAll({
    where: { projectId },
    include: [{ model: User, as: 'user', attributes: ['id', 'email', 'displayName'] }],
    order: [['createdAt', 'ASC']]
  });
  return grants.map((grant) => ({
    id: grant.id,
    userId: grant.userId,
    role: grant.role,
    ...(grant.user ? { email: grant.user.email, displayName: grant.user.displayName } : {}),
    createdAt: grant.createdAt
  }));
}

export async function grantProjectAccess(
  projectId: string,
  actorUserId: string,
  input: { email: string; role: AccessRole }
): Promise<Record<string, unknown>> {
  const decision = await requireProjectRole(projectId, actorUserId, 'admin');
  if (input.role === 'owner') {
    throw new AppError('ROLE_NOT_ASSIGNABLE', 'Ownership is transferred, not granted.', {
      status: 422,
      path: 'role'
    });
  }
  const user = await User.findOne({ where: { email: input.email }, attributes: ['id'] });
  if (!user) {
    throw new AppError('ACCESS_NOT_GRANTABLE', 'That person cannot be given access yet.', {
      status: 422,
      path: 'email'
    });
  }
  const existing = await ProjectAccess.findOne({ where: { projectId, userId: user.id } });
  const grant = existing
    ? await existing.update({ role: input.role, grantedByUserId: actorUserId })
    : await ProjectAccess.create({
      projectId,
      userId: user.id,
      role: input.role,
      grantedByUserId: actorUserId
    });
  await recordAudit({
    action: 'project.access_granted',
    actorUserId,
    projectId,
    workspaceId: decision.workspaceId,
    entityType: 'projectAccess',
    entityId: grant.id,
    metadata: { role: input.role }
  });
  return { id: grant.id, userId: grant.userId, role: grant.role };
}

export async function revokeProjectAccess(
  projectId: string,
  actorUserId: string,
  grantId: string
): Promise<Record<string, unknown>> {
  const decision = await requireProjectRole(projectId, actorUserId, 'admin');
  const grant = await ProjectAccess.findOne({ where: { id: grantId, projectId } });
  if (!grant) throw notFound('project access grant', grantId);
  await grant.destroy();
  await recordAudit({
    action: 'project.access_revoked',
    actorUserId,
    projectId,
    workspaceId: decision.workspaceId,
    entityType: 'projectAccess',
    entityId: grantId,
    metadata: { role: grant.role }
  });
  return { revoked: true, grantId };
}

export { ACCESS_ROLES };
