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
import { ASSET_DERIVATIVE_KINDS, emptyJsonObject } from './model.types';
import type { AssetDerivativeKind, JsonObject } from './model.types';

export class AssetDerivative extends Model<
  InferAttributes<AssetDerivative>,
  InferCreationAttributes<AssetDerivative>
> {
  declare id: CreationOptional<string>;
  declare assetId: ForeignKey<Asset['id']>;
  declare kind: AssetDerivativeKind;
  declare version: number;
  declare storageKey: string;
  declare mimeType: string;
  declare width: number | null;
  declare height: number | null;
  declare sizeBytes: string;
  declare metadata: CreationOptional<JsonObject>;
  declare createdAt: CreationOptional<Date>;

  declare asset?: NonAttribute<Asset>;

  static initialize(sequelize: Sequelize): typeof AssetDerivative {
    if (sequelize.models.AssetDerivative === AssetDerivative) {
      return AssetDerivative;
    }

    AssetDerivative.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        assetId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'asset_id',
        },
        kind: {
          type: DataTypes.STRING(64),
          allowNull: false,
          validate: { isIn: [ASSET_DERIVATIVE_KINDS] },
        },
        version: {
          type: DataTypes.INTEGER,
          allowNull: false,
          validate: { min: 1 },
        },
        storageKey: {
          type: DataTypes.STRING(1024),
          allowNull: false,
          field: 'storage_key',
        },
        mimeType: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: 'mime_type',
        },
        width: {
          type: DataTypes.INTEGER,
          allowNull: true,
          validate: { min: 1 },
        },
        height: {
          type: DataTypes.INTEGER,
          allowNull: true,
          validate: { min: 1 },
        },
        sizeBytes: {
          type: DataTypes.BIGINT,
          allowNull: false,
          field: 'size_bytes',
          validate: { min: 0 },
        },
        metadata: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
        },
        createdAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'AssetDerivative',
        tableName: 'asset_derivatives',
        underscored: true,
        timestamps: true,
        updatedAt: false,
        indexes: [
          {
            name: 'asset_derivatives_asset_kind_version_unique',
            unique: true,
            fields: ['asset_id', 'kind', 'version'],
          },
          { name: 'asset_derivatives_storage_key_unique', unique: true, fields: ['storage_key'] },
        ],
        hooks: {
          beforeUpdate(): never {
            throw new Error('Asset derivatives are immutable; create a new version instead');
          },
          beforeBulkUpdate(): never {
            throw new Error('Asset derivatives are immutable; create a new version instead');
          },
        },
      },
    );

    return AssetDerivative;
  }
}
