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

import { emptyJsonObject, PUBLICATION_STATUSES, PUBLICATION_VISIBILITIES } from './model.types';
import type {
  JsonObject,
  PublicationStatus,
  PublicationVisibility,
} from './model.types';
import type { Project } from './project.model';

const IMMUTABLE_PUBLICATION_FIELDS = [
  'projectId',
  'projectRevision',
  'publicationRevision',
  'slug',
  'visibility',
  'compiledManifestVersion',
  'compiledManifest',
] as const;

export class Publication extends Model<
  InferAttributes<Publication>,
  InferCreationAttributes<Publication>
> {
  declare id: CreationOptional<string>;
  declare projectId: ForeignKey<Project['id']>;
  declare projectRevision: number;
  declare publicationRevision: number;
  declare slug: string;
  declare visibility: PublicationVisibility;
  declare compiledManifestVersion: string;
  declare compiledManifest: JsonObject | null;
  declare status: CreationOptional<PublicationStatus>;
  declare isCurrent: CreationOptional<boolean>;
  declare shareMetadata: CreationOptional<JsonObject>;
  declare failureError: JsonObject | null;
  declare publishedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare project?: NonAttribute<Project>;

  static initialize(sequelize: Sequelize): typeof Publication {
    if (sequelize.models.Publication === Publication) {
      return Publication;
    }

    Publication.init(
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
        projectRevision: {
          type: DataTypes.INTEGER,
          allowNull: false,
          field: 'project_revision',
          validate: { min: 1 },
        },
        publicationRevision: {
          type: DataTypes.INTEGER,
          allowNull: false,
          field: 'publication_revision',
          validate: { min: 1 },
        },
        slug: {
          type: DataTypes.STRING(255),
          allowNull: false,
          validate: {
            is: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
            len: [1, 255],
          },
        },
        visibility: {
          type: DataTypes.STRING(32),
          allowNull: false,
          validate: { isIn: [PUBLICATION_VISIBILITIES] },
        },
        compiledManifestVersion: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'compiled_manifest_version',
        },
        compiledManifest: {
          type: DataTypes.JSONB,
          allowNull: true,
          field: 'compiled_manifest',
        },
        status: {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: 'publishing',
          validate: { isIn: [PUBLICATION_STATUSES] },
        },
        isCurrent: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          field: 'is_current',
        },
        shareMetadata: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'share_metadata',
        },
        failureError: {
          type: DataTypes.JSONB,
          allowNull: true,
          field: 'failure_error',
        },
        publishedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'published_at',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Publication',
        tableName: 'publications',
        underscored: true,
        indexes: [
          {
            name: 'publications_project_revision_unique',
            unique: true,
            fields: ['project_id', 'publication_revision'],
          },
          { name: 'publications_slug_current_status_idx', fields: ['slug', 'is_current', 'status'] },
          {
            name: 'publications_one_current_per_project_unique',
            unique: true,
            fields: ['project_id'],
            where: { is_current: true },
          },
          {
            name: 'publications_one_current_per_slug_unique',
            unique: true,
            fields: ['slug'],
            where: { is_current: true },
          },
        ],
        hooks: {
          beforeUpdate(publication): void {
            for (const field of IMMUTABLE_PUBLICATION_FIELDS) {
              if (publication.changed(field)) {
                throw new Error(`Publication field ${field} is immutable`);
              }
            }
          },
          beforeBulkUpdate(options): void {
            const attributes = (
              options as typeof options & { attributes: Record<string, unknown> }
            ).attributes;
            for (const field of IMMUTABLE_PUBLICATION_FIELDS) {
              if (Object.prototype.hasOwnProperty.call(attributes, field)) {
                throw new Error(`Publication field ${field} is immutable`);
              }
            }
          },
        },
      },
    );

    return Publication;
  }
}
