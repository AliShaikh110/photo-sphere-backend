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
import { emptyJsonObject, PROJECT_TYPES } from './model.types';
import type { JsonObject, ProjectType } from './model.types';
import type { TimelineInteraction } from './timeline-interaction.model';
import type { Publication } from './publication.model';
import type { PublishedSceneDefinition } from './published-scene-definition.model';
import type { RuntimeEvent } from './runtime-event.model';
import type { Scene } from './scene.model';
import type { User } from './user.model';

export class Project extends Model<InferAttributes<Project>, InferCreationAttributes<Project>> {
  declare id: CreationOptional<string>;
  declare ownerId: ForeignKey<User['id']>;
  declare workspaceId: CreationOptional<string | null>;
  declare type: CreationOptional<ProjectType>;
  declare name: string;
  declare schemaVersion: CreationOptional<number>;
  declare revision: CreationOptional<number>;
  declare settings: CreationOptional<JsonObject>;
  declare branding: CreationOptional<JsonObject>;
  declare videoAssetId: CreationOptional<ForeignKey<Asset['id']> | null>;
  declare videoSettings: CreationOptional<JsonObject>;
  declare publicationMetadata: CreationOptional<JsonObject>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare owner?: NonAttribute<User>;
  declare assets?: NonAttribute<Asset[]>;
  declare scenes?: NonAttribute<Scene[]>;
  declare timeline?: NonAttribute<TimelineInteraction[]>;
  declare videoAsset?: NonAttribute<Asset>;
  declare publications?: NonAttribute<Publication[]>;
  declare publishedSceneDefinitions?: NonAttribute<PublishedSceneDefinition[]>;
  declare runtimeEvents?: NonAttribute<RuntimeEvent[]>;

  static initialize(sequelize: Sequelize): typeof Project {
    if (sequelize.models.Project === Project) {
      return Project;
    }

    Project.init(
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
        workspaceId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'workspace_id',
        },
        type: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'image360',
          validate: { isIn: [PROJECT_TYPES] },
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          validate: { notEmpty: true },
        },
        schemaVersion: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
          field: 'schema_version',
          validate: { min: 1 },
        },
        revision: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
          validate: { min: 1 },
        },
        settings: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        branding: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        videoAssetId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'video_asset_id',
        },
        videoSettings: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'video_settings',
        },
        publicationMetadata: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'publication_metadata',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Project',
        tableName: 'projects',
        underscored: true,
        indexes: [
          { name: 'projects_owner_updated_idx', fields: ['owner_id', 'updated_at'] },
          { name: 'projects_id_revision_unique', unique: true, fields: ['id', 'revision'] },
          { name: 'projects_video_asset_idx', fields: ['video_asset_id'] },
          { name: 'projects_workspace_updated_idx', fields: ['workspace_id', 'updated_at'] },
        ],
      },
    );

    return Project;
  }
}
