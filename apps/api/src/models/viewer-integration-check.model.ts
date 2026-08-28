import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import { emptyJsonArray, VIEWER_INTEGRATION_CHECK_STATUSES } from './model.types';
import type { JsonValue, ViewerIntegrationCheckStatus } from './model.types';

/**
 * One recorded run of the reference experience suite against a candidate viewer
 * integration version. A version cannot be promoted without a passing run, so
 * this table is the rollout gate rather than a report.
 */
export class ViewerIntegrationCheck extends Model<
  InferAttributes<ViewerIntegrationCheck>,
  InferCreationAttributes<ViewerIntegrationCheck>
> {
  declare id: CreationOptional<string>;
  declare viewerIntegrationVersion: string;
  declare status: ViewerIntegrationCheckStatus;
  declare totalCount: CreationOptional<number>;
  declare passedCount: CreationOptional<number>;
  declare failedCount: CreationOptional<number>;
  declare results: CreationOptional<JsonValue[]>;
  declare startedAt: CreationOptional<Date>;
  declare finishedAt: Date | null;
  declare ranByUserId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof ViewerIntegrationCheck {
    if (sequelize.models.ViewerIntegrationCheck === ViewerIntegrationCheck) {
      return ViewerIntegrationCheck;
    }

    ViewerIntegrationCheck.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        viewerIntegrationVersion: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'viewer_integration_version',
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          validate: { isIn: [VIEWER_INTEGRATION_CHECK_STATUSES] },
        },
        totalCount: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          field: 'total_count',
          validate: { min: 0 },
        },
        passedCount: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          field: 'passed_count',
          validate: { min: 0 },
        },
        failedCount: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          field: 'failed_count',
          validate: { min: 0 },
        },
        results: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonArray,
        },
        startedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: 'started_at',
        },
        finishedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'finished_at',
        },
        ranByUserId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'ran_by_user_id',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'ViewerIntegrationCheck',
        tableName: 'viewer_integration_checks',
        underscored: true,
        indexes: [
          {
            name: 'viewer_integration_checks_version_status_idx',
            fields: ['viewer_integration_version', 'status', 'finished_at'],
          },
        ],
      },
    );

    return ViewerIntegrationCheck;
  }
}
