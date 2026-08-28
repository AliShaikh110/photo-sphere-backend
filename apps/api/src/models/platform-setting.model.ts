import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import { emptyJsonObject } from './model.types';
import type { JsonObject } from './model.types';

/**
 * Durable operational settings, keyed by a small fixed set of names. This is
 * platform state such as the viewer integration rollout — never customer
 * Experience data and never renderer configuration.
 */
export class PlatformSetting extends Model<
  InferAttributes<PlatformSetting>,
  InferCreationAttributes<PlatformSetting>
> {
  declare key: string;
  declare value: CreationOptional<JsonObject>;
  declare updatedByUserId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof PlatformSetting {
    if (sequelize.models.PlatformSetting === PlatformSetting) {
      return PlatformSetting;
    }

    PlatformSetting.init(
      {
        key: {
          type: DataTypes.STRING(64),
          allowNull: false,
          primaryKey: true,
        },
        value: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        updatedByUserId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'updated_by_user_id',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'PlatformSetting',
        tableName: 'platform_settings',
        underscored: true,
      },
    );

    return PlatformSetting;
  }
}
