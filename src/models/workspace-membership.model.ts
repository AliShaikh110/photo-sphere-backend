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

import { ACCESS_ROLES, MEMBERSHIP_STATUSES } from './model.types';
import type { AccessRole, MembershipStatus } from './model.types';
import type { User } from './user.model';
import type { Workspace } from './workspace.model';

export class WorkspaceMembership extends Model<
  InferAttributes<WorkspaceMembership>,
  InferCreationAttributes<WorkspaceMembership>
> {
  declare id: CreationOptional<string>;
  declare workspaceId: ForeignKey<Workspace['id']>;
  declare userId: ForeignKey<User['id']>;
  declare role: AccessRole;
  declare status: CreationOptional<MembershipStatus>;
  declare invitedByUserId: ForeignKey<User['id']> | null;
  declare invitedAt: CreationOptional<Date>;
  declare acceptedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare workspace?: NonAttribute<Workspace>;
  declare user?: NonAttribute<User>;

  static initialize(sequelize: Sequelize): typeof WorkspaceMembership {
    if (sequelize.models.WorkspaceMembership === WorkspaceMembership) {
      return WorkspaceMembership;
    }

    WorkspaceMembership.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        workspaceId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'workspace_id',
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'user_id',
        },
        role: {
          type: DataTypes.STRING(16),
          allowNull: false,
          validate: { isIn: [ACCESS_ROLES] },
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'invited',
          validate: { isIn: [MEMBERSHIP_STATUSES] },
        },
        invitedByUserId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'invited_by_user_id',
        },
        invitedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: 'invited_at',
        },
        acceptedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'accepted_at',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'WorkspaceMembership',
        tableName: 'workspace_memberships',
        underscored: true,
        indexes: [
          {
            name: 'workspace_memberships_workspace_user_unique',
            unique: true,
            fields: ['workspace_id', 'user_id'],
          },
          { name: 'workspace_memberships_user_idx', fields: ['user_id', 'status'] },
        ],
      },
    );

    return WorkspaceMembership;
  }
}
