import { DataTypes, Op, Sequelize } from 'sequelize';
import type { QueryInterface, Transaction } from 'sequelize';

interface MigrationContext {
  context: QueryInterface;
}

const now = Sequelize.literal('CURRENT_TIMESTAMP');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invokeWithTransaction(
  method: unknown,
  receiver: object,
  args: unknown[],
  optionsIndex: number,
  transaction: Transaction,
): unknown {
  if (typeof method !== 'function') throw new TypeError('Expected a migration method.');
  const nextArgs = [...args];
  const currentOptions = isRecord(nextArgs[optionsIndex]) ? nextArgs[optionsIndex] : {};
  nextArgs[optionsIndex] = { ...currentOptions, transaction };
  return Reflect.apply(method, receiver, nextArgs);
}

function transactionalQueryInterface(
  queryInterface: QueryInterface,
  transaction: Transaction,
): QueryInterface {
  const scopedSequelize = new Proxy(queryInterface.sequelize, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (...args: unknown[]) => invokeWithTransaction(
          target.query,
          target,
          args,
          1,
          transaction,
        );
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(queryInterface, {
    get(target, property, receiver) {
      if (property === 'sequelize') return scopedSequelize;
      const optionIndex = property === 'createTable' || property === 'addIndex'
        ? 2
        : property === 'dropTable' ? 1 : undefined;
      if (optionIndex !== undefined) {
        const method = Reflect.get(target, property, receiver) as unknown;
        return (...args: unknown[]) => invokeWithTransaction(
          method,
          target,
          args,
          optionIndex,
          transaction,
        );
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function addCheck(
  queryInterface: QueryInterface,
  table: string,
  name: string,
  expression: string,
): Promise<void> {
  await queryInterface.sequelize.query(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression})`,
  );
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await applyUp(transactionalQueryInterface(queryInterface, transaction));
  });
}

async function applyUp(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.createTable('users', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    email: { type: DataTypes.STRING(320), allowNull: false },
    password_hash: { type: DataTypes.STRING(255), allowNull: true },
    display_name: { type: DataTypes.STRING(120), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('users', ['email'], {
    name: 'users_email_unique',
    unique: true,
  });
  await queryInterface.addIndex('users', ['status'], { name: 'users_status_idx' });
  await addCheck(queryInterface, 'users', 'users_status_check', `status IN ('active', 'disabled')`);

  await queryInterface.createTable('projects', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    type: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'image360' },
    name: { type: DataTypes.STRING(255), allowNull: false },
    schema_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    branding: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    publication_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('projects', ['owner_id', 'updated_at'], {
    name: 'projects_owner_updated_idx',
  });
  await queryInterface.addIndex('projects', ['id', 'revision'], {
    name: 'projects_id_revision_unique',
    unique: true,
  });
  await addCheck(queryInterface, 'projects', 'projects_type_check', `type IN ('image360', 'video360')`);
  await addCheck(
    queryInterface,
    'projects',
    'projects_versions_positive_check',
    'schema_version > 0 AND revision > 0',
  );

  await queryInterface.createTable('assets', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    project_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'projects', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    source_storage_key: { type: DataTypes.STRING(1024), allowNull: false },
    source_filename: { type: DataTypes.STRING(512), allowNull: false },
    source_mime_type: { type: DataTypes.STRING(255), allowNull: false },
    source_size_bytes: { type: DataTypes.BIGINT, allowNull: false },
    source_checksum: { type: DataTypes.STRING(128), allowNull: true },
    media_type: { type: DataTypes.STRING(64), allowNull: false },
    projection: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'unknown' },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    processing_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'uploaded' },
    processing_error: { type: DataTypes.JSONB, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('assets', ['owner_id', 'project_id'], {
    name: 'assets_owner_project_idx',
  });
  await queryInterface.addIndex('assets', ['project_id'], { name: 'assets_project_idx' });
  await queryInterface.addIndex('assets', ['processing_status', 'updated_at'], {
    name: 'assets_processing_status_idx',
  });
  await queryInterface.addIndex('assets', ['source_storage_key'], {
    name: 'assets_source_storage_key_unique',
    unique: true,
  });
  await addCheck(
    queryInterface,
    'assets',
    'assets_media_type_check',
    `media_type IN ('panorama_image', 'image', 'video360', 'video', 'audio', 'logo', 'other')`,
  );
  await addCheck(
    queryInterface,
    'assets',
    'assets_projection_check',
    `projection IN ('equirectangular', 'cropped_equirectangular', 'cubemap', 'dual_fisheye', 'unknown')`,
  );
  await addCheck(
    queryInterface,
    'assets',
    'assets_processing_status_check',
    `processing_status IN ('uploaded', 'inspecting', 'processing', 'ready', 'failed')`,
  );
  await addCheck(queryInterface, 'assets', 'assets_source_size_check', 'source_size_bytes >= 0');

  await queryInterface.createTable('asset_derivatives', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    asset_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'assets', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    kind: { type: DataTypes.STRING(64), allowNull: false },
    version: { type: DataTypes.INTEGER, allowNull: false },
    storage_key: { type: DataTypes.STRING(1024), allowNull: false },
    mime_type: { type: DataTypes.STRING(255), allowNull: false },
    width: { type: DataTypes.INTEGER, allowNull: true },
    height: { type: DataTypes.INTEGER, allowNull: true },
    size_bytes: { type: DataTypes.BIGINT, allowNull: false },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('asset_derivatives', ['asset_id', 'kind', 'version'], {
    name: 'asset_derivatives_asset_kind_version_unique',
    unique: true,
  });
  await queryInterface.addIndex('asset_derivatives', ['storage_key'], {
    name: 'asset_derivatives_storage_key_unique',
    unique: true,
  });
  await addCheck(
    queryInterface,
    'asset_derivatives',
    'asset_derivatives_kind_check',
    `kind IN ('thumbnail', 'lowResolutionBase', 'standardWeb', 'tiledLevels', 'cubemap', 'videoPoster', 'desktopVideoProfile', 'mobileVideoProfile')`,
  );
  await addCheck(
    queryInterface,
    'asset_derivatives',
    'asset_derivatives_dimensions_check',
    'version > 0 AND size_bytes >= 0 AND (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)',
  );

  await queryInterface.createTable('upload_sessions', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    project_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'projects', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    asset_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'assets', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'pending' },
    storage_key: { type: DataTypes.STRING(1024), allowNull: false },
    provider_upload_id: { type: DataTypes.STRING(512), allowNull: true },
    filename: { type: DataTypes.STRING(512), allowNull: false },
    declared_mime_type: { type: DataTypes.STRING(255), allowNull: false },
    expected_size_bytes: { type: DataTypes.BIGINT, allowNull: false },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('upload_sessions', ['owner_id', 'status'], {
    name: 'upload_sessions_owner_status_idx',
  });
  await queryInterface.addIndex('upload_sessions', ['asset_id'], {
    name: 'upload_sessions_asset_idx',
  });
  await queryInterface.addIndex('upload_sessions', ['status', 'expires_at'], {
    name: 'upload_sessions_expiry_idx',
  });
  await queryInterface.addIndex('upload_sessions', ['storage_key'], {
    name: 'upload_sessions_storage_key_unique',
    unique: true,
  });
  await addCheck(
    queryInterface,
    'upload_sessions',
    'upload_sessions_status_check',
    `status IN ('pending', 'uploaded', 'completed', 'expired', 'aborted', 'failed')`,
  );
  await addCheck(
    queryInterface,
    'upload_sessions',
    'upload_sessions_size_check',
    'expected_size_bytes >= 0',
  );

  await queryInterface.createTable('media_jobs', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    asset_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'assets', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    type: { type: DataTypes.STRING(32), allowNull: false },
    stage: { type: DataTypes.STRING(64), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'queued' },
    derivative_version: { type: DataTypes.INTEGER, allowNull: false },
    idempotency_key: { type: DataTypes.STRING(255), allowNull: false },
    attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    max_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    progress: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    error: { type: DataTypes.JSONB, allowNull: true },
    available_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    locked_at: { type: DataTypes.DATE, allowNull: true },
    lease_token: { type: DataTypes.UUID, allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: true },
    finished_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('media_jobs', ['idempotency_key'], {
    name: 'media_jobs_idempotency_key_unique',
    unique: true,
  });
  await queryInterface.addIndex('media_jobs', ['asset_id', 'derivative_version'], {
    name: 'media_jobs_asset_version_unique',
    unique: true,
  });
  await queryInterface.addIndex('media_jobs', ['asset_id'], {
    name: 'media_jobs_one_active_per_asset_unique',
    unique: true,
    where: { status: { [Op.in]: ['queued', 'running'] } },
  });
  await queryInterface.addIndex('media_jobs', ['status', 'available_at'], {
    name: 'media_jobs_status_available_idx',
  });
  await queryInterface.addIndex('media_jobs', ['asset_id', 'status'], {
    name: 'media_jobs_asset_status_idx',
  });
  await addCheck(
    queryInterface,
    'media_jobs',
    'media_jobs_type_check',
    `type IN ('inspect', 'process', 'reprocess')`,
  );
  await addCheck(
    queryInterface,
    'media_jobs',
    'media_jobs_status_check',
    `status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
  );
  await addCheck(
    queryInterface,
    'media_jobs',
    'media_jobs_attempt_progress_check',
    'derivative_version > 0 AND attempt >= 0 AND max_attempts > 0 AND progress BETWEEN 0 AND 100',
  );

  // This table intentionally has no asset foreign key: its rows must survive the
  // transaction that removes the logical asset and its dependent records.
  await queryInterface.createTable('storage_deletion_jobs', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    asset_id: { type: DataTypes.UUID, allowNull: false },
    storage_key: { type: DataTypes.STRING(1024), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'queued' },
    attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    available_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    locked_at: { type: DataTypes.DATE, allowNull: true },
    lease_token: { type: DataTypes.UUID, allowNull: true },
    last_error: { type: DataTypes.JSONB, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('storage_deletion_jobs', ['storage_key'], {
    name: 'storage_deletion_jobs_storage_key_unique',
    unique: true,
  });
  await queryInterface.addIndex('storage_deletion_jobs', ['status', 'available_at'], {
    name: 'storage_deletion_jobs_status_available_idx',
  });
  await queryInterface.addIndex('storage_deletion_jobs', ['asset_id'], {
    name: 'storage_deletion_jobs_asset_idx',
  });
  await addCheck(
    queryInterface,
    'storage_deletion_jobs',
    'storage_deletion_jobs_status_check',
    `status IN ('queued', 'running', 'succeeded')`,
  );
  await addCheck(
    queryInterface,
    'storage_deletion_jobs',
    'storage_deletion_jobs_attempt_check',
    'attempt >= 0',
  );
  await addCheck(
    queryInterface,
    'storage_deletion_jobs',
    'storage_deletion_jobs_lease_state_check',
    `(
      status = 'queued' AND locked_at IS NULL AND lease_token IS NULL AND completed_at IS NULL
    ) OR (
      status = 'running' AND locked_at IS NOT NULL AND lease_token IS NOT NULL AND completed_at IS NULL
    ) OR (
      status = 'succeeded' AND locked_at IS NULL AND lease_token IS NULL AND completed_at IS NOT NULL
    )`,
  );

  await queryInterface.createTable('scenes', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    project_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'projects', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    name: { type: DataTypes.STRING(255), allowNull: false },
    panorama_asset_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'assets', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    initial_view: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    view_limits: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    overlays: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    connections: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    spatial_data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    runtime_hints: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('scenes', ['project_id', 'sort_order'], {
    name: 'scenes_project_sort_idx',
  });
  await queryInterface.addIndex('scenes', ['panorama_asset_id'], {
    name: 'scenes_panorama_asset_idx',
  });
  await queryInterface.addIndex('scenes', ['project_id'], {
    name: 'scenes_one_primary_per_project_unique',
    unique: true,
    where: { is_primary: true },
  });
  await addCheck(queryInterface, 'scenes', 'scenes_sort_order_check', 'sort_order >= 0');

  await queryInterface.createTable('hotspots', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    scene_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'scenes', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    geometry: { type: DataTypes.JSONB, allowNull: false },
    position: { type: DataTypes.JSONB, allowNull: false },
    appearance: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    content: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    action: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    visibility_rules: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('hotspots', ['scene_id', 'sort_order'], {
    name: 'hotspots_scene_sort_idx',
  });
  await addCheck(queryInterface, 'hotspots', 'hotspots_sort_order_check', 'sort_order >= 0');

  await queryInterface.createTable('publications', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    project_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'projects', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    project_revision: { type: DataTypes.INTEGER, allowNull: false },
    publication_revision: { type: DataTypes.INTEGER, allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: false },
    visibility: { type: DataTypes.STRING(32), allowNull: false },
    compiled_manifest_version: { type: DataTypes.STRING(64), allowNull: false },
    compiled_manifest: { type: DataTypes.JSONB, allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'publishing' },
    is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    share_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    failure_error: { type: DataTypes.JSONB, allowNull: true },
    published_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex('publications', ['project_id', 'publication_revision'], {
    name: 'publications_project_revision_unique',
    unique: true,
  });
  await queryInterface.addIndex('publications', ['slug', 'is_current', 'status'], {
    name: 'publications_slug_current_status_idx',
  });
  await queryInterface.addIndex('publications', ['project_id'], {
    name: 'publications_one_current_per_project_unique',
    unique: true,
    where: { is_current: true },
  });
  await queryInterface.addIndex('publications', ['slug'], {
    name: 'publications_one_current_per_slug_unique',
    unique: true,
    where: { is_current: true },
  });
  await addCheck(
    queryInterface,
    'publications',
    'publications_visibility_check',
    `visibility IN ('public', 'private', 'unlisted')`,
  );
  await addCheck(
    queryInterface,
    'publications',
    'publications_status_check',
    `status IN ('publishing', 'published', 'publish_failed', 'retired')`,
  );
  await addCheck(
    queryInterface,
    'publications',
    'publications_revision_check',
    'project_revision > 0 AND publication_revision > 0',
  );
  await addCheck(
    queryInterface,
    'publications',
    'publications_current_check',
    `(NOT is_current) OR (status = 'published' AND compiled_manifest IS NOT NULL AND published_at IS NOT NULL)`,
  );

  await queryInterface.createTable('idempotency_records', {
    id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    operation: { type: DataTypes.STRING(64), allowNull: false },
    idempotency_key: { type: DataTypes.STRING(255), allowNull: false },
    request_fingerprint: { type: DataTypes.STRING(128), allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'in_progress' },
    response_status: { type: DataTypes.INTEGER, allowNull: true },
    response_body: { type: DataTypes.JSONB, allowNull: true },
    resource_type: { type: DataTypes.STRING(64), allowNull: true },
    resource_id: { type: DataTypes.UUID, allowNull: true },
    locked_until: { type: DataTypes.DATE, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex(
    'idempotency_records',
    ['owner_id', 'operation', 'idempotency_key'],
    {
      name: 'idempotency_records_owner_operation_key_unique',
      unique: true,
    },
  );
  await queryInterface.addIndex('idempotency_records', ['expires_at'], {
    name: 'idempotency_records_expiry_idx',
  });
  await addCheck(
    queryInterface,
    'idempotency_records',
    'idempotency_records_status_check',
    `status IN ('in_progress', 'completed', 'failed')`,
  );
  await addCheck(
    queryInterface,
    'idempotency_records',
    'idempotency_records_response_status_check',
    'response_status IS NULL OR response_status BETWEEN 100 AND 599',
  );

  await queryInterface.createTable('runtime_events', {
    event_id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    event_name: { type: DataTypes.STRING(64), allowNull: false },
    experience_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'projects', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    publication_revision: { type: DataTypes.INTEGER, allowNull: false },
    viewer_integration_version: { type: DataTypes.STRING(64), allowNull: false },
    session_id: { type: DataTypes.STRING(128), allowNull: false },
    device_context: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    runtime_context: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    received_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await queryInterface.addIndex(
    'runtime_events',
    ['experience_id', 'publication_revision', 'occurred_at'],
    { name: 'runtime_events_experience_revision_time_idx' },
  );
  await queryInterface.addIndex('runtime_events', ['event_name', 'occurred_at'], {
    name: 'runtime_events_name_time_idx',
  });
  await addCheck(
    queryInterface,
    'runtime_events',
    'runtime_events_name_check',
    `event_name IN ('experience_load_started', 'first_panorama_visible', 'time_to_interactive', 'scene_changed', 'hotspot_clicked', 'video_started', 'video_stalled', 'asset_failed', 'scene_transition_failed', 'viewer_error', 'experience_exited')`,
  );
  await addCheck(
    queryInterface,
    'runtime_events',
    'runtime_events_publication_revision_check',
    'publication_revision > 0',
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await applyDown(transactionalQueryInterface(queryInterface, transaction));
  });
}

async function applyDown(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.dropTable('runtime_events');
  await queryInterface.dropTable('idempotency_records');
  await queryInterface.dropTable('publications');
  await queryInterface.dropTable('hotspots');
  await queryInterface.dropTable('scenes');
  await queryInterface.dropTable('storage_deletion_jobs');
  await queryInterface.dropTable('media_jobs');
  await queryInterface.dropTable('upload_sessions');
  await queryInterface.dropTable('asset_derivatives');
  await queryInterface.dropTable('assets');
  await queryInterface.dropTable('projects');
  await queryInterface.dropTable('users');
}
