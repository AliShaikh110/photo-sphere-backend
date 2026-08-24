import type { Sequelize } from 'sequelize';

import { AssetDerivative } from './asset-derivative.model';
import { Asset } from './asset.model';
import { Hotspot } from './hotspot.model';
import { IdempotencyRecord } from './idempotency-record.model';
import { MediaJob } from './media-job.model';
import { Project } from './project.model';
import { Publication } from './publication.model';
import { PublishedSceneDefinition } from './published-scene-definition.model';
import { RuntimeEvent } from './runtime-event.model';
import { Scene } from './scene.model';
import { SceneConnection } from './scene-connection.model';
import { StorageDeletionJob } from './storage-deletion-job.model';
import { UploadSession } from './upload-session.model';
import { User } from './user.model';

export { AssetDerivative } from './asset-derivative.model';
export { Asset } from './asset.model';
export { Hotspot } from './hotspot.model';
export { IdempotencyRecord } from './idempotency-record.model';
export { MediaJob } from './media-job.model';
export * from './model.types';
export { Project } from './project.model';
export { Publication } from './publication.model';
export { PublishedSceneDefinition } from './published-scene-definition.model';
export { RuntimeEvent } from './runtime-event.model';
export { Scene } from './scene.model';
export { SceneConnection } from './scene-connection.model';
export { StorageDeletionJob } from './storage-deletion-job.model';
export { UploadSession } from './upload-session.model';
export { User } from './user.model';

export interface ModelRegistry {
  readonly User: typeof User;
  readonly Project: typeof Project;
  readonly Asset: typeof Asset;
  readonly AssetDerivative: typeof AssetDerivative;
  readonly UploadSession: typeof UploadSession;
  readonly MediaJob: typeof MediaJob;
  readonly StorageDeletionJob: typeof StorageDeletionJob;
  readonly Scene: typeof Scene;
  readonly SceneConnection: typeof SceneConnection;
  readonly Hotspot: typeof Hotspot;
  readonly Publication: typeof Publication;
  readonly PublishedSceneDefinition: typeof PublishedSceneDefinition;
  readonly IdempotencyRecord: typeof IdempotencyRecord;
  readonly RuntimeEvent: typeof RuntimeEvent;
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
    StorageDeletionJob: StorageDeletionJob.initialize(sequelize),
    Scene: Scene.initialize(sequelize),
    Hotspot: Hotspot.initialize(sequelize),
    SceneConnection: SceneConnection.initialize(sequelize),
    Publication: Publication.initialize(sequelize),
    PublishedSceneDefinition: PublishedSceneDefinition.initialize(sequelize),
    IdempotencyRecord: IdempotencyRecord.initialize(sequelize),
    RuntimeEvent: RuntimeEvent.initialize(sequelize),
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
}
