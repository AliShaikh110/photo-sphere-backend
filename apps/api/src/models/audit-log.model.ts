import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import { AUDIT_ACTIONS, emptyJsonObject } from './model.types';
import type { AuditAction, JsonObject } from './model.types';

/**
 * An append-only record of privileged changes. Entity references are stored as
 * plain identifiers rather than foreign keys so the trail survives deletion of
 * whatever it describes.
 */
export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<string>;
  declare action: AuditAction;
  declare actorUserId: string | null;
  declare workspaceId: string | null;
  declare projectId: string | null;
  declare entityType: string;
  declare entityId: string | null;
  declare metadata: CreationOptional<JsonObject>;
  declare occurredAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof AuditLog {
    if (sequelize.models.AuditLog === AuditLog) {
      return AuditLog;
    }

    AuditLog.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        action: {
          type: DataTypes.STRING(64),
          allowNull: false,
          validate: { isIn: [AUDIT_ACTIONS] },
        },
        actorUserId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'actor_user_id',
        },
        workspaceId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'workspace_id',
        },
        projectId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'project_id',
        },
        entityType: {
          type: DataTypes.STRING(32),
          allowNull: false,
          field: 'entity_type',
        },
        entityId: {
          type: DataTypes.STRING(128),
          allowNull: true,
          field: 'entity_id',
        },
        metadata: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        occurredAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: 'occurred_at',
        },
      },
      {
        sequelize,
        modelName: 'AuditLog',
        tableName: 'audit_logs',
        timestamps: false,
        underscored: true,
        indexes: [
          { name: 'audit_logs_project_time_idx', fields: ['project_id', 'occurred_at'] },
          { name: 'audit_logs_workspace_time_idx', fields: ['workspace_id', 'occurred_at'] },
          { name: 'audit_logs_actor_time_idx', fields: ['actor_user_id', 'occurred_at'] },
        ],
      },
    );

    return AuditLog;
  }
}
