import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import {
  emptyJsonObject,
  PROJECT_TYPES,
  TEMPLATE_ASSET_POLICIES,
  TEMPLATE_STATUSES,
  TEMPLATE_VISIBILITIES,
} from './model.types';
import type {
  JsonObject,
  ProjectType,
  TemplateAssetPolicy,
  TemplateStatus,
  TemplateVisibility,
} from './model.types';

/**
 * A canonical Experience blueprint. The blueprint is product data, never
 * renderer configuration, so instantiating one produces an ordinary draft
 * project that the current compiler understands.
 */
export class Template extends Model<InferAttributes<Template>, InferCreationAttributes<Template>> {
  declare id: CreationOptional<string>;
  declare ownerId: string | null;
  declare workspaceId: string | null;
  declare name: string;
  declare description: string | null;
  declare schemaVersion: CreationOptional<number>;
  declare experienceType: ProjectType;
  declare canonicalBlueprint: JsonObject;
  declare assetPolicy: CreationOptional<TemplateAssetPolicy>;
  declare visibility: CreationOptional<TemplateVisibility>;
  declare status: CreationOptional<TemplateStatus>;
  declare previewAssetId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof Template {
    if (sequelize.models.Template === Template) {
      return Template;
    }

    Template.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        ownerId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'owner_id',
        },
        workspaceId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'workspace_id',
        },
        name: {
          type: DataTypes.STRING(160),
          allowNull: false,
          validate: { notEmpty: true },
        },
        description: {
          type: DataTypes.STRING(2000),
          allowNull: true,
        },
        schemaVersion: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
          field: 'schema_version',
          validate: { min: 1 },
        },
        experienceType: {
          type: DataTypes.STRING(32),
          allowNull: false,
          field: 'experience_type',
          validate: { isIn: [PROJECT_TYPES] },
        },
        canonicalBlueprint: {
          type: DataTypes.JSONB,
          allowNull: false,
          field: 'canonical_blueprint',
        },
        assetPolicy: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'omit',
          field: 'asset_policy',
          validate: { isIn: [TEMPLATE_ASSET_POLICIES] },
        },
        visibility: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'platform',
          validate: { isIn: [TEMPLATE_VISIBILITIES] },
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'published',
          validate: { isIn: [TEMPLATE_STATUSES] },
        },
        previewAssetId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'preview_asset_id',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Template',
        tableName: 'templates',
        underscored: true,
        indexes: [
          {
            name: 'templates_scope_type_idx',
            fields: ['visibility', 'experience_type', 'status'],
          },
          { name: 'templates_workspace_idx', fields: ['workspace_id'] },
          { name: 'templates_owner_idx', fields: ['owner_id'] },
        ],
      },
    );

    return Template;
  }
}

export const templateMetadataDefaults = emptyJsonObject;
