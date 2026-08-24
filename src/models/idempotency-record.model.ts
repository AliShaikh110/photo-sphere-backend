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

import { IDEMPOTENCY_STATUSES } from './model.types';
import type { IdempotencyStatus, JsonObject } from './model.types';
import type { User } from './user.model';

export class IdempotencyRecord extends Model<
  InferAttributes<IdempotencyRecord>,
  InferCreationAttributes<IdempotencyRecord>
> {
  declare id: CreationOptional<string>;
  declare ownerId: ForeignKey<User['id']>;
  declare operation: string;
  declare key: string;
  declare requestFingerprint: string;
  declare status: CreationOptional<IdempotencyStatus>;
  declare responseStatus: number | null;
  declare responseBody: JsonObject | null;
  declare resourceType: string | null;
  declare resourceId: string | null;
  declare lockedUntil: Date | null;
  declare expiresAt: Date;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare owner?: NonAttribute<User>;

  static initialize(sequelize: Sequelize): typeof IdempotencyRecord {
    if (sequelize.models.IdempotencyRecord === IdempotencyRecord) {
      return IdempotencyRecord;
    }

    IdempotencyRecord.init(
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
        operation: {
          type: DataTypes.STRING(64),
          allowNull: false,
        },
        key: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: 'idempotency_key',
        },
        requestFingerprint: {
          type: DataTypes.STRING(128),
          allowNull: false,
          field: 'request_fingerprint',
        },
        status: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'in_progress',
          validate: { isIn: [IDEMPOTENCY_STATUSES] },
        },
        responseStatus: {
          type: DataTypes.INTEGER,
          allowNull: true,
          field: 'response_status',
          validate: { min: 100, max: 599 },
        },
        responseBody: {
          type: DataTypes.JSONB,
          allowNull: true,
          field: 'response_body',
        },
        resourceType: {
          type: DataTypes.STRING(64),
          allowNull: true,
          field: 'resource_type',
        },
        resourceId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'resource_id',
        },
        lockedUntil: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'locked_until',
        },
        expiresAt: {
          type: DataTypes.DATE,
          allowNull: false,
          field: 'expires_at',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'IdempotencyRecord',
        tableName: 'idempotency_records',
        underscored: true,
        indexes: [
          {
            name: 'idempotency_records_owner_operation_key_unique',
            unique: true,
            fields: ['owner_id', 'operation', 'idempotency_key'],
          },
          { name: 'idempotency_records_expiry_idx', fields: ['expires_at'] },
        ],
      },
    );

    return IdempotencyRecord;
  }
}
