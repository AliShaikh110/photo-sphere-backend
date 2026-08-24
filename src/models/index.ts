import type { Sequelize } from 'sequelize';

import { AssetDerivative } from './asset-derivative.model';
import { Asset } from './asset.model';
import { AuditLog } from './audit-log.model';
import { CustomDomain } from './custom-domain.model';
import { Extension } from './extension.model';
import { Hotspot } from './hotspot.model';
import { Overlay } from './overlay.model';
import { Plan } from './plan.model';
import { ProjectAccess } from './project-access.model';
import { PublicationShareToken } from './publication-share-token.model';
import { Template } from './template.model';
import { Workspace } from './workspace.model';
import { WorkspaceMembership } from './workspace-membership.model';
import { IdempotencyRecord } from './idempotency-record.model';
import { MediaJob } from './media-job.model';
import { MediaJobStage } from './media-job-stage.model';
import { Project } from './project.model';
import { Publication } from './publication.model';
import { PublishedSceneDefinition } from './published-scene-definition.model';
import { RuntimeEvent } from './runtime-event.model';
import { Scene } from './scene.model';
import { SceneConnection } from './scene-connection.model';
import { StorageDeletionJob } from './storage-deletion-job.model';
import { TimelineInteraction } from './timeline-interaction.model';
import { UploadSession } from './upload-session.model';
import { User } from './user.model';

export { AssetDerivative } from './asset-derivative.model';
export { Asset } from './asset.model';
export { AuditLog } from './audit-log.model';
export { CustomDomain } from './custom-domain.model';
export { Extension } from './extension.model';
export { Hotspot } from './hotspot.model';
export { Overlay } from './overlay.model';
export { Plan } from './plan.model';
export { ProjectAccess } from './project-access.model';
export { PublicationShareToken } from './publication-share-token.model';
export { Template } from './template.model';
export { Workspace } from './workspace.model';
export { WorkspaceMembership } from './workspace-membership.model';
export { IdempotencyRecord } from './idempotency-record.model';
export { MediaJob } from './media-job.model';
export { MediaJobStage } from './media-job-stage.model';
export * from './model.types';
export { Project } from './project.model';
export { Publication } from './publication.model';
export { PublishedSceneDefinition } from './published-scene-definition.model';
export { RuntimeEvent } from './runtime-event.model';
export { Scene } from './scene.model';
export { SceneConnection } from './scene-connection.model';
export { StorageDeletionJob } from './storage-deletion-job.model';
export { TimelineInteraction } from './timeline-interaction.model';
export { UploadSession } from './upload-session.model';
export { User } from './user.model';

export interface ModelRegistry {
  readonly User: typeof User;
  readonly Project: typeof Project;
  readonly Asset: typeof Asset;
  readonly AssetDerivative: typeof AssetDerivative;
  readonly UploadSession: typeof UploadSession;
  readonly MediaJob: typeof MediaJob;
  readonly MediaJobStage: typeof MediaJobStage;
  readonly StorageDeletionJob: typeof StorageDeletionJob;
  readonly Scene: typeof Scene;
  readonly SceneConnection: typeof SceneConnection;
  readonly Hotspot: typeof Hotspot;
  readonly TimelineInteraction: typeof TimelineInteraction;
  readonly Publication: typeof Publication;
  readonly PublishedSceneDefinition: typeof PublishedSceneDefinition;
  readonly IdempotencyRecord: typeof IdempotencyRecord;
  readonly RuntimeEvent: typeof RuntimeEvent;
  readonly Plan: typeof Plan;
  readonly Overlay: typeof Overlay;
  readonly Workspace: typeof Workspace;
  readonly WorkspaceMembership: typeof WorkspaceMembership;
  readonly ProjectAccess: typeof ProjectAccess;
  readonly AuditLog: typeof AuditLog;
  readonly Template: typeof Template;
  readonly Extension: typeof Extension;
  readonly PublicationShareToken: typeof PublicationShareToken;
  readonly CustomDomain: typeof CustomDomain;
}

const associationRegistries = new WeakSet<Sequelize>();

export function initializeModels(sequelize: Sequelize): ModelRegistry {
  const registry: ModelRegistry = {
    User: User.initialize(sequelize),
    Project: Project.initialize(sequelize),
    Asset: Asset.initialize(sequelize),
    AssetDerivative: AssetDerivative.initialize(sequelize),
    UploadSession: UploadSession.initialize(sequelize),
    MediaJob: MediaJob.initialize(sequelize),
    MediaJobStage: MediaJobStage.initialize(sequelize),
    StorageDeletionJob: StorageDeletionJob.initialize(sequelize),
    Scene: Scene.initialize(sequelize),
    Hotspot: Hotspot.initialize(sequelize),
    TimelineInteraction: TimelineInteraction.initialize(sequelize),
    SceneConnection: SceneConnection.initialize(sequelize),
    Publication: Publication.initialize(sequelize),
    PublishedSceneDefinition: PublishedSceneDefinition.initialize(sequelize),
    IdempotencyRecord: IdempotencyRecord.initialize(sequelize),
    RuntimeEvent: RuntimeEvent.initialize(sequelize),
    Plan: Plan.initialize(sequelize),
    Overlay: Overlay.initialize(sequelize),
    Workspace: Workspace.initialize(sequelize),
    WorkspaceMembership: WorkspaceMembership.initialize(sequelize),
    ProjectAccess: ProjectAccess.initialize(sequelize),
    AuditLog: AuditLog.initialize(sequelize),
    Template: Template.initialize(sequelize),
    Extension: Extension.initialize(sequelize),
    PublicationShareToken: PublicationShareToken.initialize(sequelize),
    CustomDomain: CustomDomain.initialize(sequelize),
  };

  if (!associationRegistries.has(sequelize)) {
    registerAssociations(registry);
    associationRegistries.add(sequelize);
  }

  return registry;
}

function registerAssociations(models: ModelRegistry): void {
  models.User.hasMany(models.Project, {
    as: 'projects',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Project.belongsTo(models.User, {
    as: 'owner',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.User.hasMany(models.Asset, {
    as: 'assets',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Asset.belongsTo(models.User, {
    as: 'owner',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Project.hasMany(models.Asset, {
    as: 'assets',
    foreignKey: 'projectId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  models.Asset.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });

  models.Asset.hasMany(models.AssetDerivative, {
    as: 'derivatives',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.AssetDerivative.belongsTo(models.Asset, {
    as: 'asset',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.User.hasMany(models.UploadSession, {
    as: 'uploadSessions',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.UploadSession.belongsTo(models.User, {
    as: 'owner',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Project.hasMany(models.UploadSession, {
    as: 'uploadSessions',
    foreignKey: 'projectId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  models.UploadSession.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  models.Asset.hasMany(models.UploadSession, {
    as: 'uploadSessions',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.UploadSession.belongsTo(models.Asset, {
    as: 'asset',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.Asset.hasMany(models.MediaJob, {
    as: 'mediaJobs',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.MediaJob.belongsTo(models.Asset, {
    as: 'asset',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.Asset.hasMany(models.Project, {
    as: 'videoProjects',
    foreignKey: 'videoAssetId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  models.Project.belongsTo(models.Asset, {
    as: 'videoAsset',
    foreignKey: 'videoAssetId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });

  models.MediaJob.hasMany(models.MediaJobStage, {
    as: 'stages',
    foreignKey: 'mediaJobId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.MediaJobStage.belongsTo(models.MediaJob, {
    as: 'mediaJob',
    foreignKey: 'mediaJobId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Asset.hasMany(models.MediaJobStage, {
    as: 'mediaJobStages',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.MediaJobStage.belongsTo(models.Asset, {
    as: 'asset',
    foreignKey: 'assetId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.Project.hasMany(models.TimelineInteraction, {
    as: 'timeline',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.TimelineInteraction.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.Project.hasMany(models.Scene, {
    as: 'scenes',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Scene.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Asset.hasMany(models.Scene, {
    as: 'panoramaScenes',
    foreignKey: 'panoramaAssetId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  models.Scene.belongsTo(models.Asset, {
    as: 'panoramaAsset',
    foreignKey: 'panoramaAssetId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });

  models.Scene.hasMany(models.Hotspot, {
    as: 'hotspots',
    foreignKey: 'sceneId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Hotspot.belongsTo(models.Scene, {
    as: 'scene',
    foreignKey: 'sceneId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.Scene.hasMany(models.SceneConnection, {
    as: 'connections',
    foreignKey: 'sourceSceneId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.SceneConnection.belongsTo(models.Scene, {
    as: 'sourceScene',
    foreignKey: 'sourceSceneId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Scene.hasMany(models.SceneConnection, {
    as: 'inboundConnections',
    foreignKey: 'targetSceneId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  models.SceneConnection.belongsTo(models.Scene, {
    as: 'targetScene',
    foreignKey: 'targetSceneId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  models.Hotspot.hasMany(models.SceneConnection, {
    as: 'triggeredConnections',
    foreignKey: 'triggerHotspotId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  models.SceneConnection.belongsTo(models.Hotspot, {
    as: 'triggerHotspot',
    foreignKey: 'triggerHotspotId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });

  models.Project.hasMany(models.Publication, {
    as: 'publications',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Publication.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Project.hasMany(models.PublishedSceneDefinition, {
    as: 'publishedSceneDefinitions',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.PublishedSceneDefinition.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Publication.hasMany(models.PublishedSceneDefinition, {
    as: 'sceneDefinitions',
    foreignKey: 'publicationId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.PublishedSceneDefinition.belongsTo(models.Publication, {
    as: 'publication',
    foreignKey: 'publicationId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.User.hasMany(models.IdempotencyRecord, {
    as: 'idempotencyRecords',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.IdempotencyRecord.belongsTo(models.User, {
    as: 'owner',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.Project.hasMany(models.RuntimeEvent, {
    as: 'runtimeEvents',
    foreignKey: 'experienceId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.RuntimeEvent.belongsTo(models.Project, {
    as: 'experience',
    foreignKey: 'experienceId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Project.hasMany(models.Plan, {
    as: 'plans',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Plan.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Asset.hasMany(models.Plan, {
    as: 'plans',
    foreignKey: 'assetId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  models.Plan.belongsTo(models.Asset, {
    as: 'asset',
    foreignKey: 'assetId',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });

  models.Scene.hasMany(models.Overlay, {
    as: 'overlays',
    foreignKey: 'sceneId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Overlay.belongsTo(models.Scene, {
    as: 'scene',
    foreignKey: 'sceneId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.User.hasMany(models.Workspace, {
    as: 'ownedWorkspaces',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Workspace.belongsTo(models.User, {
    as: 'owner',
    foreignKey: 'ownerId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Workspace.hasMany(models.WorkspaceMembership, {
    as: 'memberships',
    foreignKey: 'workspaceId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.WorkspaceMembership.belongsTo(models.Workspace, {
    as: 'workspace',
    foreignKey: 'workspaceId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.User.hasMany(models.WorkspaceMembership, {
    as: 'workspaceMemberships',
    foreignKey: 'userId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.WorkspaceMembership.belongsTo(models.User, {
    as: 'user',
    foreignKey: 'userId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.Workspace.hasMany(models.Project, {
    as: 'projects',
    foreignKey: 'workspaceId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });
  models.Project.belongsTo(models.Workspace, {
    as: 'workspace',
    foreignKey: 'workspaceId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  });

  models.Project.hasMany(models.ProjectAccess, {
    as: 'accessGrants',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.ProjectAccess.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.User.hasMany(models.ProjectAccess, {
    as: 'projectAccessGrants',
    foreignKey: 'userId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.ProjectAccess.belongsTo(models.User, {
    as: 'user',
    foreignKey: 'userId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });

  models.Project.hasMany(models.PublicationShareToken, {
    as: 'shareTokens',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
  models.PublicationShareToken.belongsTo(models.Project, {
    as: 'project',
    foreignKey: 'projectId',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  });
}

