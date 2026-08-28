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

import { ACCESS_ROLES } from './model.types';
import type { AccessRole } from './model.types';
import type { Project } from './project.model';
import type { User } from './user.model';

/** A per-project grant that can raise, but never lower, workspace access. */
export class ProjectAccess extends Model<
  InferAttributes<ProjectAccess>,
  InferCreationAttributes<ProjectAccess>
> {
  declare id: CreationOptional<string>;
  declare projectId: ForeignKey<Project['id']>;
  declare userId: ForeignKey<User['id']>;
  declare role: AccessRole;
  declare grantedByUserId: ForeignKey<User['id']> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare project?: NonAttribute<Project>;
  declare user?: NonAttribute<User>;

  static initialize(sequelize: Sequelize): typeof ProjectAccess {
    if (sequelize.models.ProjectAccess === ProjectAccess) {
      return ProjectAccess;
    }

    ProjectAccess.init(
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
        grantedByUserId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'granted_by_user_id',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'ProjectAccess',
        tableName: 'project_access',
        underscored: true,
        indexes: [
          {
            name: 'project_access_project_user_unique',
            unique: true,
            fields: ['project_id', 'user_id'],
          },
          { name: 'project_access_user_idx', fields: ['user_id'] },
        ],
      },
    );

    return ProjectAccess;
  }
}
