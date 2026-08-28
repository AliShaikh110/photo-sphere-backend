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

import { emptyJsonObject, RUNTIME_EVENT_NAMES } from './model.types';
import type { JsonObject, RuntimeEventName } from './model.types';
import type { Project } from './project.model';

export class RuntimeEvent extends Model<
  InferAttributes<RuntimeEvent>,
  InferCreationAttributes<RuntimeEvent>
> {
  declare eventId: CreationOptional<string>;
  declare eventName: RuntimeEventName;
  declare experienceId: ForeignKey<Project['id']>;
  declare publicationRevision: number;
  declare viewerIntegrationVersion: string;
  declare sessionId: string;
  declare deviceContext: CreationOptional<JsonObject>;
  declare runtimeContext: CreationOptional<JsonObject>;
  declare payload: CreationOptional<JsonObject>;
  declare occurredAt: Date;
  declare receivedAt: CreationOptional<Date>;

  declare experience?: NonAttribute<Project>;

  static initialize(sequelize: Sequelize): typeof RuntimeEvent {
    if (sequelize.models.RuntimeEvent === RuntimeEvent) {
      return RuntimeEvent;
    }

    RuntimeEvent.init(
      {
        eventId: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
          field: 'event_id',
        },
        eventName: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'event_name',
          validate: { isIn: [RUNTIME_EVENT_NAMES] },
        },
        experienceId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'experience_id',
        },
        publicationRevision: {
          type: DataTypes.INTEGER,
          allowNull: false,
          field: 'publication_revision',
          validate: { min: 1 },
        },
        viewerIntegrationVersion: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'viewer_integration_version',
        },
        sessionId: {
          type: DataTypes.STRING(128),
          allowNull: false,
          field: 'session_id',
        },
        deviceContext: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'device_context',
        },
        runtimeContext: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'runtime_context',
        },
        payload: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        occurredAt: {
          type: DataTypes.DATE,
          allowNull: false,
          field: 'occurred_at',
        },
        receivedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: 'received_at',
        },
      },
      {
        sequelize,
        modelName: 'RuntimeEvent',
        tableName: 'runtime_events',
        timestamps: false,
        indexes: [
          {
            name: 'runtime_events_experience_revision_time_idx',
            fields: ['experience_id', 'publication_revision', 'occurred_at'],
          },
          { name: 'runtime_events_name_time_idx', fields: ['event_name', 'occurred_at'] },
        ],
      },
    );

    return RuntimeEvent;
  }
}
