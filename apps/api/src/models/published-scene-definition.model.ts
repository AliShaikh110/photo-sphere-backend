import type {
  CreationOptional,
  ForeignKey,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
  Sequelize,
} from 'sequelize';
import { DataTypes, Model } from 'sequelize';

import type { JsonObject } from './model.types';
import type { Project } from './project.model';
import type { Publication } from './publication.model';

const IMMUTABLE_PUBLISHED_SCENE_FIELDS = [
  'id',
  'publicationId',
  'projectId',
  'publicationRevision',
  'sceneId',
  'compiledSceneVersion',
  'compiledScene',
  'checksum',
  'createdAt',
] as const;

export class PublishedSceneDefinition extends Model<
  InferAttributes<PublishedSceneDefinition>,
  InferCreationAttributes<PublishedSceneDefinition>
> {
  declare id: CreationOptional<string>;
  declare publicationId: ForeignKey<Publication['id']>;
  declare projectId: ForeignKey<Project['id']>;
  declare publicationRevision: number;
  /** Stable scene identity copied from the draft; deliberately not a draft-scene foreign key. */
  declare sceneId: string;
  declare compiledSceneVersion: string;
  declare compiledScene: JsonObject;
  /** Lower-case SHA-256 of the canonical serialized compiled scene. */
  declare checksum: string;
  declare createdAt: CreationOptional<Date>;

  declare publication?: NonAttribute<Publication>;
  declare project?: NonAttribute<Project>;

  static initialize(sequelize: Sequelize): typeof PublishedSceneDefinition {
    if (sequelize.models.PublishedSceneDefinition === PublishedSceneDefinition) {
      return PublishedSceneDefinition;
    }

    PublishedSceneDefinition.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        publicationId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'publication_id',
        },
        projectId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'project_id',
        },
        publicationRevision: {
          type: DataTypes.INTEGER,
          allowNull: false,
          field: 'publication_revision',
          validate: { min: 1 },
        },
        sceneId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'scene_id',
        },
        compiledSceneVersion: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'compiled_scene_version',
        },
        compiledScene: {
          type: DataTypes.JSONB,
          allowNull: false,
          field: 'compiled_scene',
        },
        checksum: {
          type: DataTypes.STRING(64),
          allowNull: false,
          validate: { is: /^[a-f0-9]{64}$/ },
        },
        createdAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'PublishedSceneDefinition',
        tableName: 'published_scene_definitions',
        underscored: true,
        updatedAt: false,
        indexes: [{
          name: 'published_scene_definitions_project_revision_scene_unique',
          unique: true,
          fields: ['project_id', 'publication_revision', 'scene_id'],
        }],
        hooks: {
          beforeUpdate(definition): void {
            for (const field of IMMUTABLE_PUBLISHED_SCENE_FIELDS) {
              if (definition.changed(field)) {
                throw new Error(`Published scene definition field ${field} is immutable`);
              }
            }
          },
          beforeBulkUpdate(options): void {
            const attributes = (
              options as typeof options & { attributes: Record<string, unknown> }
            ).attributes;
            for (const field of IMMUTABLE_PUBLISHED_SCENE_FIELDS) {
              if (Object.prototype.hasOwnProperty.call(attributes, field)) {
                throw new Error(`Published scene definition field ${field} is immutable`);
              }
            }
          },
        },
      },
    );

    return PublishedSceneDefinition;
  }
}
