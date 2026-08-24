import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

import { emptyJsonObject, EXTENSION_STATUSES } from './model.types';
import type { ExtensionStatus, JsonObject, JsonValue } from './model.types';

/**
 * The allow-list of custom interaction contracts. A publication may only pin a
 * registered extension version, so no experience can reference arbitrary
 * client code.
 */
export class Extension extends Model<
  InferAttributes<Extension>,
  InferCreationAttributes<Extension>
> {
  declare id: CreationOptional<string>;
  declare extensionId: string;
  declare version: string;
  declare name: string;
  declare description: string | null;
  declare supportedExperienceTypes: JsonValue[];
  declare schema: JsonObject;
  declare requiredCapabilities: JsonValue[];
  declare runtimeModule: string;
  declare securityPolicy: CreationOptional<JsonObject>;
  declare status: CreationOptional<ExtensionStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof Extension {
    if (sequelize.models.Extension === Extension) {
      return Extension;
    }

    Extension.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        extensionId: {
          type: DataTypes.STRING(128),
          allowNull: false,
          field: 'extension_id',
          validate: { is: /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/ },
        },
        version: {
          type: DataTypes.STRING(32),
          allowNull: false,
          validate: { is: /^\d+\.\d+\.\d+$/ },
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
        supportedExperienceTypes: {
          type: DataTypes.JSONB,
          allowNull: false,
          field: 'supported_experience_types',
        },
        schema: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        requiredCapabilities: {
          type: DataTypes.JSONB,
          allowNull: false,
          field: 'required_capabilities',
        },
        runtimeModule: {
          type: DataTypes.STRING(160),
          allowNull: false,
          field: 'runtime_module',
        },
        securityPolicy: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: emptyJsonObject,
          field: 'security_policy',
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'draft',
          validate: { isIn: [EXTENSION_STATUSES] },
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'Extension',
        tableName: 'extensions',
        underscored: true,
        indexes: [
          {
            name: 'extensions_id_version_unique',
            unique: true,
            fields: ['extension_id', 'version'],
          },
          { name: 'extensions_status_idx', fields: ['status'] },
        ],
      },
    );

    return Extension;
  }
}
