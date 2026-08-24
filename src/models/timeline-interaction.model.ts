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

import { emptyJsonObject, TIMELINE_INTERACTION_KINDS } from './model.types';
import type { JsonObject, TimelineInteractionKind } from './model.types';
import type { Project } from './project.model';

/**
 * A canonical timed interaction on a 360 video experience. Timestamps are
 * plain milliseconds on the media timeline: they are never renderer event or
 * plugin identifiers, and they carry no viewer configuration.
 */
export class TimelineInteraction extends Model<
  InferAttributes<TimelineInteraction>,
  InferCreationAttributes<TimelineInteraction>
> {
  declare id: CreationOptional<string>;
  declare projectId: ForeignKey<Project['id']>;
  declare kind: TimelineInteractionKind;
  declare timeMs: number;
  declare endTimeMs: CreationOptional<number | null>;
  declare geometry: CreationOptional<JsonObject>;
  declare position: CreationOptional<JsonObject>;
  declare viewpoint: CreationOptional<JsonObject>;
  declare appearance: CreationOptional<JsonObject>;
  declare content: CreationOptional<JsonObject>;
  declare action: CreationOptional<JsonObject>;
  declare visibilityRules: CreationOptional<JsonObject>;
  declare sortOrder: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare project?: NonAttribute<Project>;

  static initialize(sequelize: Sequelize): typeof TimelineInteraction {
    if (sequelize.models.TimelineInteraction === TimelineInteraction) {
      return TimelineInteraction;
    }

    TimelineInteraction.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        projectId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'project_id',
        },
        kind: {
          type: DataTypes.STRING(32),
          allowNull: false,
          validate: { isIn: [TIMELINE_INTERACTION_KINDS] },
        },
        timeMs: {
          type: DataTypes.INTEGER,
          allowNull: false,
          field: 'time_ms',
          validate: { min: 0 },
        },
        endTimeMs: {
          type: DataTypes.INTEGER,
          allowNull: true,
          field: 'end_time_ms',
          validate: { min: 0 },
        },
        geometry: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        position: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        viewpoint: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        appearance: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        content: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        action: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        visibilityRules: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'visibility_rules',
        },
        sortOrder: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          field: 'sort_order',
          validate: { min: 0 },
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'TimelineInteraction',
        tableName: 'timeline_interactions',
        underscored: true,
        indexes: [
          {
            name: 'timeline_interactions_project_time_idx',
            fields: ['project_id', 'time_ms', 'sort_order', 'id'],
          },
          { name: 'timeline_interactions_project_kind_idx', fields: ['project_id', 'kind'] },
        ],
      },
    );

    return TimelineInteraction;
  }
}
