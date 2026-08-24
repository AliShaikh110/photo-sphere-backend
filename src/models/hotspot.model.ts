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
import type { Scene } from './scene.model';
import type { SceneConnection } from './scene-connection.model';

export class Hotspot extends Model<InferAttributes<Hotspot>, InferCreationAttributes<Hotspot>> {
  declare id: CreationOptional<string>;
  declare sceneId: ForeignKey<Scene['id']>;
  declare geometry: JsonObject;
  declare position: JsonObject;
  declare appearance: CreationOptional<JsonObject>;
  declare content: CreationOptional<JsonObject>;
  declare action: CreationOptional<JsonObject>;
  declare visibilityRules: CreationOptional<JsonObject>;
  declare sortOrder: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare scene?: NonAttribute<Scene>;
  declare triggeredConnections?: NonAttribute<SceneConnection[]>;

  static initialize(sequelize: Sequelize): typeof Hotspot {
    if (sequelize.models.Hotspot === Hotspot) {
      return Hotspot;
    }

    Hotspot.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        sceneId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'scene_id',
        },
        geometry: {
          type: DataTypes.JSONB,
          allowNull: false,
          validate: {
            hasKind(value: JsonObject): void {
              if (typeof value.kind !== 'string' || value.kind.length === 0) {
                throw new Error('geometry.kind is required');
              }
            },
          },
        },
        position: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        appearance: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        content: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        action: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        visibilityRules: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'visibility_rules',
        },
        sortOrder: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
          field: 'sort_order',
          validate: { min: 0 },
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Hotspot',
        tableName: 'hotspots',
        underscored: true,
        indexes: [{ name: 'hotspots_scene_sort_idx', fields: ['scene_id', 'sort_order'] }],
      },
    );

    return Hotspot;
  }
}
