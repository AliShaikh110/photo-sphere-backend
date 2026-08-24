import type {
  CreationOptional,
  ForeignKey,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import type { AssetDerivative } from './asset-derivative.model';
import type { MediaJob } from './media-job.model';
import {
  ASSET_MEDIA_TYPES,
  ASSET_PROCESSING_STATUSES,
  ASSET_PROJECTIONS,
  emptyJsonObject,
} from './model.types';
import type {
  AssetMediaType,
  AssetProcessingStatus,
  AssetProjection,
  JsonObject,
} from './model.types';
import type { Project } from './project.model';
import type { Scene } from './scene.model';
import type { UploadSession } from './upload-session.model';
import type { User } from './user.model';

export class Asset extends Model<InferAttributes<Asset>, InferCreationAttributes<Asset>> {
  declare id: CreationOptional<string>;
  declare ownerId: ForeignKey<User['id']>;
  declare projectId: ForeignKey<Project['id']> | null;
  declare sourceStorageKey: string;
  declare sourceFilename: string;
  declare sourceMimeType: string;
  declare sourceSizeBytes: string;
  declare sourceChecksum: string | null;
  declare mediaType: AssetMediaType;
  declare projection: CreationOptional<AssetProjection>;
  declare metadata: CreationOptional<JsonObject>;
  declare processingStatus: CreationOptional<AssetProcessingStatus>;
  declare processingError: JsonObject | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare owner?: NonAttribute<User>;
  declare project?: NonAttribute<Project>;
  declare derivatives?: NonAttribute<AssetDerivative[]>;
  declare uploadSessions?: NonAttribute<UploadSession[]>;
  declare mediaJobs?: NonAttribute<MediaJob[]>;
  declare panoramaScenes?: NonAttribute<Scene[]>;

  static initialize(sequelize: Sequelize): typeof Asset {
    if (sequelize.models.Asset === Asset) {
      return Asset;
    }

    Asset.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        ownerId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'owner_id',
        },
        projectId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'project_id',
        },
        sourceStorageKey: {
          type: DataTypes.STRING(1024),
          allowNull: false,
          field: 'source_storage_key',
        },
        sourceFilename: {
          type: DataTypes.STRING(512),
          allowNull: false,
          field: 'source_filename',
        },
        sourceMimeType: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: 'source_mime_type',
        },
        sourceSizeBytes: {
          type: DataTypes.BIGINT,
          allowNull: false,
          field: 'source_size_bytes',
          validate: { min: 0 },
        },
        sourceChecksum: {
          type: DataTypes.STRING(128),
          allowNull: true,
          field: 'source_checksum',
        },
        mediaType: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'media_type',
          validate: { isIn: [ASSET_MEDIA_TYPES] },
        },
        projection: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: 'unknown',
          validate: { isIn: [ASSET_PROJECTIONS] },
        },
        metadata: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        processingStatus: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'uploaded',
          field: 'processing_status',
          validate: { isIn: [ASSET_PROCESSING_STATUSES] },
        },
        processingError: {
          type: DataTypes.JSONB,
          allowNull: true,
          field: 'processing_error',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Asset',
        tableName: 'assets',
        underscored: true,
        indexes: [
          { name: 'assets_owner_project_idx', fields: ['owner_id', 'project_id'] },
          { name: 'assets_project_idx', fields: ['project_id'] },
          { name: 'assets_processing_status_idx', fields: ['processing_status', 'updated_at'] },
          { name: 'assets_source_storage_key_unique', unique: true, fields: ['source_storage_key'] },
        ],
      },
    );

    return Asset;
  }
}
