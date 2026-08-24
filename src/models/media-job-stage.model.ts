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
import {
  ASSET_DERIVATIVE_KINDS,
  emptyJsonObject,
  MEDIA_JOB_STAGE_NAMES,
  MEDIA_JOB_STAGE_STATUSES,
} from './model.types';
import type {
  AssetDerivativeKind,
  JsonObject,
  MediaJobStageName,
  MediaJobStageStatus,
} from './model.types';
import type { MediaJob } from './media-job.model';

/**
 * Per-stage progress inside one logical media job. Video assets produce
 * several independent playback derivatives, so a single failed profile must
 * remain individually diagnosable and individually retryable.
 */
export class MediaJobStage extends Model<
  InferAttributes<MediaJobStage>,
  InferCreationAttributes<MediaJobStage>
> {
  declare id: CreationOptional<string>;
  declare mediaJobId: ForeignKey<MediaJob['id']>;
  declare assetId: ForeignKey<Asset['id']>;
  declare stage: MediaJobStageName;
  declare status: CreationOptional<MediaJobStageStatus>;
  declare derivativeKind: CreationOptional<AssetDerivativeKind | null>;
  declare derivativeVersion: number;
  declare attempt: CreationOptional<number>;
  declare required: CreationOptional<boolean>;
  declare error: CreationOptional<JsonObject | null>;
  declare diagnostics: CreationOptional<JsonObject>;
  declare startedAt: CreationOptional<Date | null>;
  declare finishedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare mediaJob?: NonAttribute<MediaJob>;
  declare asset?: NonAttribute<Asset>;

  static initialize(sequelize: Sequelize): typeof MediaJobStage {
    if (sequelize.models.MediaJobStage === MediaJobStage) {
      return MediaJobStage;
    }

    MediaJobStage.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        mediaJobId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'media_job_id',
        },
        assetId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'asset_id',
        },
        stage: {
          type: DataTypes.STRING(32),
          allowNull: false,
          validate: { isIn: [MEDIA_JOB_STAGE_NAMES] },
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'pending',
          validate: { isIn: [MEDIA_JOB_STAGE_STATUSES] },
        },
        derivativeKind: {
          type: DataTypes.STRING(64),
          allowNull: true,
          field: 'derivative_kind',
          validate: { isIn: [[...ASSET_DERIVATIVE_KINDS]] },
        },
        derivativeVersion: {
          type: DataTypes.INTEGER,
          allowNull: false,
          field: 'derivative_version',
          validate: { min: 1 },
        },
        attempt: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          validate: { min: 0 },
        },
        required: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        error: {
          type: DataTypes.JSONB,
          allowNull: true,
        },
        diagnostics: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
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
        modelName: 'MediaJobStage',
        tableName: 'media_job_stages',
        underscored: true,
        indexes: [
          {
            name: 'media_job_stages_job_stage_unique',
            unique: true,
            fields: ['media_job_id', 'stage'],
          },
          {
            name: 'media_job_stages_asset_stage_status_idx',
            fields: ['asset_id', 'stage', 'status'],
          },
        ],
      },
    );

    return MediaJobStage;
  }
}
