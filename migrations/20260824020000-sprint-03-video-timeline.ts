import { DataTypes, Sequelize } from 'sequelize';
import type { QueryInterface, Transaction } from 'sequelize';

interface MigrationContext {
  context: QueryInterface;
}

const now = Sequelize.literal('CURRENT_TIMESTAMP');

const TIMELINE_INTERACTION_KINDS = [
  'information',
  'hotspot',
  'viewpoint',
  'image',
  'video',
  'link',
  'cta',
];

const MEDIA_JOB_STAGE_NAMES = [
  'inspect',
  'poster',
  'transcodeDesktop',
  'transcodeMobile',
  'derivatives',
  'finalize',
];

const MEDIA_JOB_STAGE_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped'];

const ASSET_DERIVATIVE_KINDS = [
  'thumbnail',
  'lowResolutionBase',
  'standardWeb',
  'tiledLevels',
  'cubemap',
  'videoPoster',
  'desktopVideoProfile',
  'mobileVideoProfile',
];

const RUNTIME_EVENT_NAMES = [
  'experience_load_started',
  'first_panorama_visible',
  'time_to_interactive',
  'scene_changed',
  'hotspot_clicked',
  'video_started',
  'video_stalled',
  'asset_failed',
  'scene_transition_failed',
  'viewer_error',
  'experience_exited',
  'video_paused',
  'video_resumed',
  'video_seeked',
  'video_ended',
  'video_profile_selected',
  'video_playback_failed',
  'timeline_interaction_shown',
  'timeline_interaction_clicked',
];

const LEGACY_RUNTIME_EVENT_NAMES = RUNTIME_EVENT_NAMES.slice(0, 11);

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

async function dropCheck(
  queryInterface: QueryInterface,
  transaction: Transaction,
  table: string,
  name: string,
): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`,
    { transaction },
  );
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // The primary logical 360 video asset of a video360 project. RESTRICT keeps
    // a published experience from losing its only playback source.
    await queryInterface.addColumn('projects', 'video_asset_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'assets', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    }, { transaction });
    await queryInterface.addColumn('projects', 'video_settings', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    }, { transaction });
    await queryInterface.addIndex('projects', ['video_asset_id'], {
      name: 'projects_video_asset_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'projects',
      'projects_video_asset_type_check',
      `video_asset_id IS NULL OR type = 'video360'`,
    );

    await queryInterface.createTable('timeline_interactions', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      project_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      kind: { type: DataTypes.STRING(32), allowNull: false },
      time_ms: { type: DataTypes.INTEGER, allowNull: false },
      end_time_ms: { type: DataTypes.INTEGER, allowNull: true },
      geometry: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      position: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      viewpoint: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      appearance: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      content: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      action: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      visibility_rules: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    // Timeline reads are always "this project, ordered by time"; the trailing
    // columns make that ordering total and index-only.
    await queryInterface.addIndex(
      'timeline_interactions',
      ['project_id', 'time_ms', 'sort_order', 'id'],
      { name: 'timeline_interactions_project_time_idx', transaction },
    );
    await queryInterface.addIndex('timeline_interactions', ['project_id', 'kind'], {
      name: 'timeline_interactions_project_kind_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'timeline_interactions',
      'timeline_interactions_kind_check',
      `kind IN (${quotedList(TIMELINE_INTERACTION_KINDS)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'timeline_interactions',
      'timeline_interactions_time_check',
      'time_ms >= 0 AND sort_order >= 0 AND (end_time_ms IS NULL OR end_time_ms >= time_ms)',
    );

    await queryInterface.createTable('media_job_stages', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      media_job_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'media_jobs', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      asset_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'assets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      stage: { type: DataTypes.STRING(32), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
      derivative_kind: { type: DataTypes.STRING(64), allowNull: true },
      derivative_version: { type: DataTypes.INTEGER, allowNull: false },
      attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      error: { type: DataTypes.JSONB, allowNull: true },
      // Transcoder vendor detail belongs here, never in canonical project data.
      diagnostics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      started_at: { type: DataTypes.DATE, allowNull: true },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('media_job_stages', ['media_job_id', 'stage'], {
      name: 'media_job_stages_job_stage_unique',
      unique: true,
      transaction,
    });
    await queryInterface.addIndex('media_job_stages', ['asset_id', 'stage', 'status'], {
      name: 'media_job_stages_asset_stage_status_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'media_job_stages',
      'media_job_stages_stage_check',
      `stage IN (${quotedList(MEDIA_JOB_STAGE_NAMES)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'media_job_stages',
      'media_job_stages_status_check',
      `status IN (${quotedList(MEDIA_JOB_STAGE_STATUSES)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'media_job_stages',
      'media_job_stages_derivative_check',
      `derivative_version > 0 AND attempt >= 0 AND (derivative_kind IS NULL OR derivative_kind IN (${quotedList(ASSET_DERIVATIVE_KINDS)}))`,
    );

    // Derivative kind/version lookups now also serve playback profile selection.
    await queryInterface.addIndex('asset_derivatives', ['kind', 'version'], {
      name: 'asset_derivatives_kind_version_idx',
      transaction,
    });

    await dropCheck(queryInterface, transaction, 'runtime_events', 'runtime_events_name_check');
    await addCheck(
      queryInterface,
      transaction,
      'runtime_events',
      'runtime_events_name_check',
      `event_name IN (${quotedList(RUNTIME_EVENT_NAMES)})`,
    );
  });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `DELETE FROM "runtime_events" WHERE event_name NOT IN (${quotedList(LEGACY_RUNTIME_EVENT_NAMES)})`,
      { transaction },
    );
    await dropCheck(queryInterface, transaction, 'runtime_events', 'runtime_events_name_check');
    await addCheck(
      queryInterface,
      transaction,
      'runtime_events',
      'runtime_events_name_check',
      `event_name IN (${quotedList(LEGACY_RUNTIME_EVENT_NAMES)})`,
    );

    await queryInterface.removeIndex('asset_derivatives', 'asset_derivatives_kind_version_idx', {
      transaction,
    });
    await queryInterface.dropTable('media_job_stages', { transaction });
    await queryInterface.dropTable('timeline_interactions', { transaction });
    await dropCheck(queryInterface, transaction, 'projects', 'projects_video_asset_type_check');
    await queryInterface.removeIndex('projects', 'projects_video_asset_idx', { transaction });
    await queryInterface.removeColumn('projects', 'video_settings', { transaction });
    await queryInterface.removeColumn('projects', 'video_asset_id', { transaction });
  });
}
