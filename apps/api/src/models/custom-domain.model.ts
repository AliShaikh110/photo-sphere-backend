import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize} from 'sequelize';
import {
  DataTypes,
  Model
} from 'sequelize';

export const CUSTOM_DOMAIN_STATUSES = ['pending', 'verified', 'failed', 'disabled'] as const;
export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

/**
 * Custom hostname mapping for published experiences. Certificate issuance and
 * DNS live with the hosting provider; the platform owns the mapping, the
 * verification handshake and the enabled/disabled state.
 */
export class CustomDomain extends Model<
  InferAttributes<CustomDomain>,
  InferCreationAttributes<CustomDomain>
> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare hostname: string;
  declare status: CreationOptional<CustomDomainStatus>;
  declare verificationToken: string;
  declare verifiedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static initialize(sequelize: Sequelize): typeof CustomDomain {
    if (sequelize.models.CustomDomain === CustomDomain) {
      return CustomDomain;
    }

    CustomDomain.init(
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        workspaceId: {
          type: DataTypes.UUID,
          allowNull: false,
          field: 'workspace_id',
        },
        hostname: {
          type: DataTypes.STRING(253),
          allowNull: false,
          validate: { is: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/ },
        },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'pending',
          validate: { isIn: [CUSTOM_DOMAIN_STATUSES] },
        },
        verificationToken: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'verification_token',
        },
        verifiedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'verified_at',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'CustomDomain',
        tableName: 'custom_domains',
        underscored: true,
        indexes: [
          { name: 'custom_domains_hostname_unique', unique: true, fields: ['hostname'] },
          { name: 'custom_domains_workspace_idx', fields: ['workspace_id'] },
        ],
      },
    );

    return CustomDomain;
  }
}
