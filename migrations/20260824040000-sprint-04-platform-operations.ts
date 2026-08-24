import { DataTypes, Sequelize } from 'sequelize';
import type { QueryInterface, Transaction } from 'sequelize';

interface MigrationContext {
  context: QueryInterface;
}

const now = Sequelize.literal('CURRENT_TIMESTAMP');

const VIEWER_INTEGRATION_CHECK_STATUSES = ['running', 'passed', 'failed'];
const PLATFORM_ROLES = ['member', 'platform_admin'];

function quotedList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

async function addCheck(
  queryInterface: QueryInterface,
  transaction: Transaction,
  table: string,
  name: string,
  expression: string,
): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression})`,
    { transaction },
  );
}

/**
 * Operational state that outlives a process: the viewer integration rollout and
 * the reference experience suite results that gate it.
 *
 * These are platform operations records, not customer Experience data. No saved
 * project is rewritten when a renderer integration version changes.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Operator surfaces (extension registry, viewer integration rollout) need a
    // platform-level role that is independent of project and workspace access.
    await queryInterface.addColumn('users', 'platform_role', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'member',
    }, { transaction });
    await addCheck(
      queryInterface,
      transaction,
      'users',
      'users_platform_role_check',
      `platform_role IN (${quotedList(PLATFORM_ROLES)})`,
    );
    await queryInterface.addIndex('users', ['platform_role'], {
      name: 'users_platform_role_idx',
      transaction,
    });

    await queryInterface.createTable('platform_settings', {
      key: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
      value: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      updated_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });

    await queryInterface.createTable('viewer_integration_checks', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      viewer_integration_version: { type: DataTypes.STRING(64), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false },
      total_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      passed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      failed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      results: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      ran_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });

    await queryInterface.addIndex(
      'viewer_integration_checks',
      ['viewer_integration_version', 'status', 'finished_at'],
      { name: 'viewer_integration_checks_version_status_idx', transaction },
    );
    await addCheck(
      queryInterface,
      transaction,
      'viewer_integration_checks',
      'viewer_integration_checks_status_check',
      `status IN (${quotedList(VIEWER_INTEGRATION_CHECK_STATUSES)})
        AND total_count >= 0 AND passed_count >= 0 AND failed_count >= 0`,
    );

    // Publication lookups by share-token holders and by rollout audits.
    await queryInterface.addIndex('publications', ['slug', 'publication_revision'], {
      name: 'publications_slug_revision_idx',
      transaction,
    });

    // The complete scene index for large tours. The manifest ships only the
    // first segment; the paged scene-index route reads this artifact.
    await queryInterface.addColumn('publications', 'scene_index', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    }, { transaction });
  });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeColumn('publications', 'scene_index', { transaction });
    await queryInterface.removeIndex('publications', 'publications_slug_revision_idx', { transaction });
    await queryInterface.removeIndex(
      'viewer_integration_checks',
      'viewer_integration_checks_version_status_idx',
      { transaction },
    );
    await queryInterface.dropTable('viewer_integration_checks', { transaction });
    await queryInterface.dropTable('platform_settings', { transaction });
    await queryInterface.removeIndex('users', 'users_platform_role_idx', { transaction });
    await queryInterface.sequelize.query(
      'ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_platform_role_check"',
      { transaction },
    );
    await queryInterface.removeColumn('users', 'platform_role', { transaction });
  });
}
