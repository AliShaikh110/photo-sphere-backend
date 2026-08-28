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

import type { Project } from './project.model';
import type { User } from './user.model';

/**
 * A revocable link grant for a private experience. Only the hash is stored, so
 * a database read never yields a working share link.
 */
export class PublicationShareToken extends Model<
  InferAttributes<PublicationShareToken>,
  InferCreationAttributes<PublicationShareToken>
> {
  declare id: CreationOptional<string>;
  declare projectId: ForeignKey<Project['id']>;
  declare tokenHash: string;
  declare label: string | null;
  /** Null pins the token to whatever revision is current at access time. */
  declare publicationRevision: number | null;
  declare expiresAt: Date | null;
  declare revokedAt: Date | null;
  declare lastUsedAt: Date | null;
  declare createdByUserId: ForeignKey<User['id']> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare project?: NonAttribute<Project>;

  static initialize(sequelize: Sequelize): typeof PublicationShareToken {
    if (sequelize.models.PublicationShareToken === PublicationShareToken) {
      return PublicationShareToken;
    }

    PublicationShareToken.init(
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
        tokenHash: {
          type: DataTypes.STRING(64),
          allowNull: false,
          field: 'token_hash',
        },
        label: {
          type: DataTypes.STRING(160),
          allowNull: true,
        },
        publicationRevision: {
          type: DataTypes.INTEGER,
          allowNull: true,
          field: 'publication_revision',
        },
        expiresAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'expires_at',
        },
        revokedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'revoked_at',
        },
        lastUsedAt: {
          type: DataTypes.DATE,
          allowNull: true,
          field: 'last_used_at',
        },
        createdByUserId: {
          type: DataTypes.UUID,
          allowNull: true,
          field: 'created_by_user_id',
        },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: 'PublicationShareToken',
        tableName: 'publication_share_tokens',
        underscored: true,
        indexes: [
          {
            name: 'publication_share_tokens_hash_unique',
            unique: true,
            fields: ['token_hash'],
          },
          { name: 'publication_share_tokens_project_idx', fields: ['project_id'] },
        ],
      },
    );

    return PublicationShareToken;
  }
}
