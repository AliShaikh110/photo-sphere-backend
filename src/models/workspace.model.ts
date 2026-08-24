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

import { emptyJsonObject } from './model.types';
import type { JsonObject } from './model.types';
import type { Project } from './project.model';
import type { User } from './user.model';
import type { WorkspaceMembership } from './workspace-membership.model';

/** The team boundary that owns projects, templates and access policy. */
export class Workspace extends Model<
  InferAttributes<Workspace>,
  InferCreationAttributes<Workspace>
> {
  declare id: CreationOptional<string>;
  declare ownerId: ForeignKey<User['id']>;
  declare name: string;
  declare slug: string;
  declare settings: CreationOptional<JsonObject>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare owner?: NonAttribute<User>;
  declare memberships?: NonAttribute<WorkspaceMembership[]>;
  declare projects?: NonAttribute<Project[]>;

  static initialize(sequelize: Sequelize): typeof Workspace {
    if (sequelize.models.Workspace === Workspace) {
      return Workspace;
    }

    Workspace.init(
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
        name: {
          type: DataTypes.STRING(160),
          allowNull: false,
          validate: { notEmpty: true },
        },
        slug: {
          type: DataTypes.STRING(100),
          allowNull: false,
          validate: { is: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
        },
        settings: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Workspace',
        tableName: 'workspaces',
        underscored: true,
        indexes: [
          { name: 'workspaces_slug_unique', unique: true, fields: ['slug'] },
          { name: 'workspaces_owner_idx', fields: ['owner_id'] },
        ],
      },
    );

    return Workspace;
  }
}
