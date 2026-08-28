import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';
import { DataTypes, Model } from 'sequelize';

import { STORAGE_DELETION_JOB_STATUSES } from './model.types';
import type { JsonObject, StorageDeletionJobStatus } from './model.types';

export class StorageDeletionJob extends Model<
  InferAttributes<StorageDeletionJob>,
  InferCreationAttributes<StorageDeletionJob>
> {
  declare id: CreationOptional<string>;
  declare assetId: string;
  declare storageKey: string;
  declare status: CreationOptional<StorageDeletionJobStatus>;
  declare attempt: CreationOptional<number>;
  declare availableAt: CreationOptional<Date>;
  declare lockedAt: CreationOptional<Date | null>;
  declare leaseToken: CreationOptional<string | null>;
  declare lastError: CreationOptional<JsonObject | null>;
  declare completedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof StorageDeletionJob {
    if (sequelize.models.StorageDeletionJob === StorageDeletionJob) return StorageDeletionJob;

    StorageDeletionJob.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        assetId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'asset_id',
        },
        storageKey: {
          type: DataTypes.STRING(1024),
          allowNull: false,
          field: 'storage_key',
        },
        status: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'queued',
          validate: { isIn: [STORAGE_DELETION_JOB_STATUSES] },
        },
        attempt: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          validate: { min: 0 },
        },
        availableAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: 'available_at',
        },
        lockedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'locked_at',
        },
        leaseToken: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'lease_token',
        },
        lastError: {
          type: DataTypes.JSONB,
          allowNull: true,
          field: 'last_error',
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
        modelName: 'StorageDeletionJob',
        tableName: 'storage_deletion_jobs',
        underscored: true,
        indexes: [
          {
            name: 'storage_deletion_jobs_storage_key_unique',
            unique: true,
            fields: ['storage_key'],
          },
          {
            name: 'storage_deletion_jobs_status_available_idx',
            fields: ['status', 'available_at'],
          },
          { name: 'storage_deletion_jobs_asset_idx', fields: ['asset_id'] },
        ],
      },
    );

    return StorageDeletionJob;
  }
}
