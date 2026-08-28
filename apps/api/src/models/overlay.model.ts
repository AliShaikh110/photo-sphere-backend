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

import { emptyJsonObject, INTERACTION_GEOMETRY_KINDS } from './model.types';
import type { InteractionGeometryKind, JsonObject } from './model.types';
import type { Scene } from './scene.model';

/**
 * A scene-layer visual element: an area, a route, a media layer or a
 * registered custom interaction. Geometry stays canonical; the compiler's
 * integration adapter is what turns it into renderer configuration.
 */
export class Overlay extends Model<InferAttributes<Overlay>, InferCreationAttributes<Overlay>> {
  declare id: CreationOptional<string>;
  declare sceneId: ForeignKey<Scene['id']>;
  declare name: string | null;
  declare geometryKind: InteractionGeometryKind;
  declare geometry: JsonObject;
  declare position: CreationOptional<JsonObject>;
  declare appearance: CreationOptional<JsonObject>;
  declare content: CreationOptional<JsonObject>;
  declare action: CreationOptional<JsonObject>;
  declare visibilityRules: CreationOptional<JsonObject>;
  /** Set only for custom geometry, so publications can pin extension versions. */
  declare extensionId: string | null;
  declare extensionVersion: string | null;
  declare sortOrder: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare scene?: NonAttribute<Scene>;

  static initialize(sequelize: Sequelize): typeof Overlay {
    if (sequelize.models.Overlay === Overlay) {
      return Overlay;
    }

    Overlay.init(
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
        name: {
          type: DataTypes.STRING(240),
          allowNull: true,
        },
        geometryKind: {
          type: DataTypes.STRING(32),
          allowNull: false,
          field: 'geometry_kind',
          validate: { isIn: [INTERACTION_GEOMETRY_KINDS] },
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
          defaultValue: emptyJsonObject,
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
        extensionId: {
          type: DataTypes.STRING(128),
          allowNull: true,
          field: 'extension_id',
        },
        extensionVersion: {
          type: DataTypes.STRING(32),
          allowNull: true,
          field: 'extension_version',
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
        modelName: 'Overlay',
        tableName: 'overlays',
        underscored: true,
        indexes: [
          { name: 'overlays_scene_sort_idx', fields: ['scene_id', 'sort_order'] },
          { name: 'overlays_extension_idx', fields: ['extension_id', 'extension_version'] },
        ],
      },
    );

    return Overlay;
  }
}
