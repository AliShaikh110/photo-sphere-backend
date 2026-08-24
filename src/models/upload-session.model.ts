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

import type { Asset } from './asset.model';
import { emptyJsonObject, UPLOAD_SESSION_STATUSES } from './model.types';
import type { JsonObject, UploadSessionStatus } from './model.types';
import type { Project } from './project.model';
import type { User } from './user.model';

export class UploadSession extends Model<
  InferAttributes<UploadSession>,
  InferCreationAttributes<UploadSession>
> {
  declare id: CreationOptional<string>;
  declare ownerId: ForeignKey<User['id']>;
  declare projectId: ForeignKey<Project['id']> | null;
  declare assetId: ForeignKey<Asset['id']>;
  declare status: CreationOptional<UploadSessionStatus>;
  declare storageKey: string;
  declare providerUploadId: string | null;
  declare filename: string;
  declare declaredMimeType: string;
  declare expectedSizeBytes: string;
  declare metadata: CreationOptional<JsonObject>;
  declare expiresAt: Date;
  declare completedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare owner?: NonAttribute<User>;
  declare project?: NonAttribute<Project>;
  declare asset?: NonAttribute<Asset>;

  static initialize(sequelize: Sequelize): typeof UploadSession {
    if (sequelize.models.UploadSession === UploadSession) {
      return UploadSession;
    }

    UploadSession.init(
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
        assetId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'asset_id',
        },
        status: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'pending',
          validate: { isIn: [UPLOAD_SESSION_STATUSES] },
        },
        storageKey: {
          type: DataTypes.STRING(1024),
          allowNull: false,
          field: 'storage_key',
        },
        providerUploadId: {
          type: DataTypes.STRING(512),
          allowNull: true,
          field: 'provider_upload_id',
        },
        filename: {
          type: DataTypes.STRING(512),
          allowNull: false,
        },
        declaredMimeType: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: 'declared_mime_type',
        },
        expectedSizeBytes: {
          type: DataTypes.BIGINT,
          allowNull: false,
          field: 'expected_size_bytes',
          validate: { min: 0 },
        },
        metadata: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        expiresAt: {
          type: DataTypes.DATE,
          allowNull: false,
          field: 'expires_at',
        },
        completedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'completed_at',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'UploadSession',
        tableName: 'upload_sessions',
        underscored: true,
        indexes: [
          { name: 'upload_sessions_owner_status_idx', fields: ['owner_id', 'status'] },
          { name: 'upload_sessions_asset_idx', fields: ['asset_id'] },
          { name: 'upload_sessions_expiry_idx', fields: ['status', 'expires_at'] },
          { name: 'upload_sessions_storage_key_unique', unique: true, fields: ['storage_key'] },
        ],
      },
    );

    return UploadSession;
  }
}
