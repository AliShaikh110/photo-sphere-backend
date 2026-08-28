import type {
  CreationOptional,
  ForeignKey,
  InferAttributes,
  InferCreationAttributes,
  NonAttribute,
  Sequelize,
} from 'sequelize';
import { DataTypes, Model } from 'sequelize';

import type { Hotspot } from './hotspot.model';
import { emptyJsonObject } from './model.types';
import type { JsonObject } from './model.types';
import type { Scene } from './scene.model';

export const SCENE_CONNECTION_PRELOAD_HINTS = ['none', 'normal', 'high'] as const;
export type SceneConnectionPreloadHint = (typeof SCENE_CONNECTION_PRELOAD_HINTS)[number];

export class SceneConnection extends Model<
  InferAttributes<SceneConnection>,
  InferCreationAttributes<SceneConnection>
> {
  declare id: CreationOptional<string>;
  declare sourceSceneId: ForeignKey<Scene['id']>;
  declare targetSceneId: ForeignKey<Scene['id']>;
  declare triggerHotspotId: ForeignKey<Hotspot['id']> | null;
  declare label: string | null;
  declare content: CreationOptional<JsonObject>;
  declare importance: number | null;
  declare preloadHint: SceneConnectionPreloadHint | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare sourceScene?: NonAttribute<Scene>;
  declare targetScene?: NonAttribute<Scene>;
  declare triggerHotspot?: NonAttribute<Hotspot>;

  static initialize(sequelize: Sequelize): typeof SceneConnection {
    if (sequelize.models.SceneConnection === SceneConnection) {
      return SceneConnection;
    }

    SceneConnection.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        sourceSceneId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'source_scene_id',
        },
        targetSceneId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'target_scene_id',
          validate: {
            differsFromSource(this: SceneConnection, value: string): void {
              if (value === this.sourceSceneId) {
                throw new Error('A scene connection must target a different scene.');
              }
            },
          },
        },
        triggerHotspotId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'trigger_hotspot_id',
        },
        label: {
          type: DataTypes.STRING(240),
          allowNull: true,
        },
        content: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        importance: {
          type: DataTypes.INTEGER,
          allowNull: true,
          validate: { min: 0, max: 100 },
        },
        preloadHint: {
          type: DataTypes.STRING(16),
          allowNull: true,
          field: 'preload_hint',
          validate: { isIn: [SCENE_CONNECTION_PRELOAD_HINTS] },
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'SceneConnection',
        tableName: 'scene_connections',
        underscored: true,
        indexes: [
          { name: 'scene_connections_source_idx', fields: ['source_scene_id'] },
          { name: 'scene_connections_target_idx', fields: ['target_scene_id'] },
          { name: 'scene_connections_trigger_hotspot_idx', fields: ['trigger_hotspot_id'] },
        ],
      },
    );

    return SceneConnection;
  }
}
