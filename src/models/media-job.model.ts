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
import { emptyJsonObject, MEDIA_JOB_STATUSES, MEDIA_JOB_TYPES } from './model.types';
import type { JsonObject, MediaJobStatus, MediaJobType } from './model.types';

export class MediaJob extends Model<InferAttributes<MediaJob>, InferCreationAttributes<MediaJob>> {
  declare id: CreationOptional<string>;
  declare assetId: ForeignKey<Asset['id']>;
  declare type: MediaJobType;
  declare stage: string;
  declare status: CreationOptional<MediaJobStatus>;
  declare derivativeVersion: number;
  declare idempotencyKey: string;
  declare attempt: CreationOptional<number>;
  declare maxAttempts: CreationOptional<number>;
  declare progress: CreationOptional<number>;
  declare payload: CreationOptional<JsonObject>;
  declare error: JsonObject | null;
  declare availableAt: CreationOptional<Date>;
  declare lockedAt: Date | null;
  declare leaseToken: CreationOptional<string | null>;
  declare startedAt: Date | null;
  declare finishedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare asset?: NonAttribute<Asset>;

  static initialize(sequelize: Sequelize): typeof MediaJob {
    if (sequelize.models.MediaJob === MediaJob) {
      return MediaJob;
    }

    MediaJob.init(
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
        type: {
          type: DataTypes.STRING(32),
          allowNull: false,
          validate: { isIn: [MEDIA_JOB_TYPES] },
        },
        stage: {
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'queued',
          validate: { isIn: [MEDIA_JOB_STATUSES] },
        },
        derivativeVersion: {
          type: DataTypes.INTEGER,
          allowNull: false,
          field: 'derivative_version',
          validate: { min: 1 },
        },
        idempotencyKey: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: 'idempotency_key',
        },
        attempt: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          validate: { min: 0 },
        },
        maxAttempts: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 3,
          field: 'max_attempts',
          validate: { min: 1 },
        },
        progress: {
          type: DataTypes.SMALLINT,
          allowNull: false,
          defaultValue: 0,
          validate: { min: 0, max: 100 },
        },
        payload: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        error: {
          type: DataTypes.JSONB,
          allowNull: true,
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
        startedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'started_at',
        },
        finishedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'finished_at',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'MediaJob',
        tableName: 'media_jobs',
        underscored: true,
        indexes: [
          { name: 'media_jobs_idempotency_key_unique', unique: true, fields: ['idempotency_key'] },
          { name: 'media_jobs_asset_version_unique', unique: true, fields: ['asset_id', 'derivative_version'] },
          {
            name: 'media_jobs_one_active_per_asset_unique',
            unique: true,
            fields: ['asset_id'],
            where: { status: ['queued', 'running'] },
          },
          { name: 'media_jobs_status_available_idx', fields: ['status', 'available_at'] },
          { name: 'media_jobs_asset_status_idx', fields: ['asset_id', 'status'] },
        ],
      },
    );

    return MediaJob;
  }
}
