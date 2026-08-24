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
import type { Hotspot } from './hotspot.model';
import { emptyJsonArray, emptyJsonObject } from './model.types';
import type { JsonObject, JsonValue } from './model.types';
import type { Project } from './project.model';

export class Scene extends Model<InferAttributes<Scene>, InferCreationAttributes<Scene>> {
  declare id: CreationOptional<string>;
  declare projectId: ForeignKey<Project['id']>;
  declare name: string;
  declare panoramaAssetId: ForeignKey<Asset['id']> | null;
  declare sortOrder: CreationOptional<number>;
  declare isPrimary: CreationOptional<boolean>;
  declare initialView: CreationOptional<JsonObject>;
  declare viewLimits: CreationOptional<JsonObject>;
  declare overlays: CreationOptional<JsonValue[]>;
  declare connections: CreationOptional<JsonValue[]>;
  declare spatialData: CreationOptional<JsonObject>;
  declare runtimeHints: CreationOptional<JsonObject>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare project?: NonAttribute<Project>;
  declare panoramaAsset?: NonAttribute<Asset>;
  declare hotspots?: NonAttribute<Hotspot[]>;

  static initialize(sequelize: Sequelize): typeof Scene {
    if (sequelize.models.Scene === Scene) {
      return Scene;
    }

    Scene.init(
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
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
          validate: { notEmpty: true },
        },
        panoramaAssetId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'panorama_asset_id',
        },
        sortOrder: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          field: 'sort_order',
          validate: { min: 0 },
        },
        isPrimary: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          field: 'is_primary',
        },
        initialView: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'initial_view',
        },
        viewLimits: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'view_limits',
        },
        overlays: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonArray,
        },
        connections: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonArray,
        },
        spatialData: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'spatial_data',
        },
        runtimeHints: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'runtime_hints',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Scene',
        tableName: 'scenes',
        underscored: true,
        indexes: [
          { name: 'scenes_project_sort_idx', fields: ['project_id', 'sort_order'] },
          { name: 'scenes_panorama_asset_idx', fields: ['panorama_asset_id'] },
          {
            name: 'scenes_one_primary_per_project_unique',
            unique: true,
            fields: ['project_id'],
            where: { is_primary: true },
          },
        ],
      },
    );

    return Scene;
  }
}
