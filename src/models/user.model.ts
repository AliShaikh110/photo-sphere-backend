import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import type { Asset } from './asset.model';
import type { IdempotencyRecord } from './idempotency-record.model';
import { USER_STATUSES } from './model.types';
import type { UserStatus } from './model.types';
import type { Project } from './project.model';
import type { UploadSession } from './upload-session.model';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare passwordHash: string | null;
  declare displayName: string;
  declare status: CreationOptional<UserStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare projects?: NonAttribute<Project[]>;
  declare assets?: NonAttribute<Asset[]>;
  declare uploadSessions?: NonAttribute<UploadSession[]>;
  declare idempotencyRecords?: NonAttribute<IdempotencyRecord[]>;

  static initialize(sequelize: Sequelize): typeof User {
    if (sequelize.models.User === User) {
      return User;
    }

    User.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        email: {
          type: DataTypes.STRING(320),
          allowNull: false,
          validate: { isEmail: true },
        },
        passwordHash: {
          type: DataTypes.STRING(255),
          allowNull: true,
          field: 'password_hash',
        },
        displayName: {
          type: DataTypes.STRING(120),
          allowNull: false,
          field: 'display_name',
        },
        status: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'active',
          validate: { isIn: [USER_STATUSES] },
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'User',
        tableName: 'users',
        underscored: true,
        indexes: [
          { name: 'users_email_unique', unique: true, fields: ['email'] },
          { name: 'users_status_idx', fields: ['status'] },
        ],
      },
    );

    return User;
  }
}
