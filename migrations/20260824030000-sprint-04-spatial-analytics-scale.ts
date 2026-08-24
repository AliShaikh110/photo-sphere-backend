import { DataTypes, Sequelize } from 'sequelize';
import type { QueryInterface, Transaction } from 'sequelize';

interface MigrationContext {
  context: QueryInterface;
}

const now = Sequelize.literal('CURRENT_TIMESTAMP');

const INTERACTION_GEOMETRY_KINDS = [
  'point',
  'polygon',
  'polyline',
  'imageLayer',
  'videoLayer',
  'custom',
];

const PLAN_COORDINATE_SYSTEMS = ['plan_normalized', 'plan_pixels'];
const ACCESS_ROLES = ['viewer', 'editor', 'admin', 'owner'];
const MEMBERSHIP_STATUSES = ['invited', 'active', 'revoked'];
const TEMPLATE_VISIBILITIES = ['platform', 'workspace', 'private'];
const TEMPLATE_STATUSES = ['draft', 'published', 'retired'];
const TEMPLATE_ASSET_POLICIES = ['reference', 'copy', 'omit'];
const EXTENSION_STATUSES = ['draft', 'active', 'deprecated', 'disabled'];
const CUSTOM_DOMAIN_STATUSES = ['pending', 'verified', 'failed', 'disabled'];
const PROJECT_TYPES = ['image360', 'video360'];

const LEGACY_ASSET_MEDIA_TYPES = [
  'panorama_image',
  'image',
  'video360',
  'video',
  'audio',
  'logo',
  'other',
];
const ASSET_MEDIA_TYPES = [
  'panorama_image',
  'image',
  'video360',
  'video',
  'audio',
  'logo',
  'plan_image',
  'other',
];

const LEGACY_ASSET_DERIVATIVE_KINDS = [
  'thumbnail',
  'lowResolutionBase',
  'standardWeb',
  'tiledLevels',
  'cubemap',
  'videoPoster',
  'desktopVideoProfile',
  'mobileVideoProfile',
];
const ASSET_DERIVATIVE_KINDS = [
  'thumbnail',
  'lowResolutionBase',
  'standardWeb',
  'tiledLevels',
  'cubemap',
  'tiledCubemap',
  'normalizedPanorama',
  'planImage',
  'videoPoster',
  'desktopVideoProfile',
  'mobileVideoProfile',
];

const LEGACY_RUNTIME_EVENT_NAMES = [
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
const RUNTIME_EVENT_NAMES = [
  ...LEGACY_RUNTIME_EVENT_NAMES,
  'capability_fallback',
  'overlay_clicked',
  'map_interaction',
];

const AUDIT_ACTIONS = [
  'project.created',
  'project.deleted',
  'project.published',
  'project.unpublished',
  'project.access_granted',
  'project.access_revoked',
  'workspace.member_invited',
  'workspace.member_role_changed',
  'workspace.member_removed',
  'asset.deleted',
  'template.instantiated',
  'publication.share_token_created',
  'publication.share_token_revoked',
  'publication.embed_policy_changed',
  'extension.status_changed',
  'viewer_integration.rollout_changed',
];

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
    /* ----------------------------------------------------------------- */
    /* Workspaces, membership and per-project access                      */
    /* ----------------------------------------------------------------- */
    await queryInterface.createTable('workspaces', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      owner_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      name: { type: DataTypes.STRING(160), allowNull: false },
      slug: { type: DataTypes.STRING(100), allowNull: false },
      settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('workspaces', ['slug'], {
      name: 'workspaces_slug_unique',
      unique: true,
      transaction,
    });
    await queryInterface.addIndex('workspaces', ['owner_id'], {
      name: 'workspaces_owner_idx',
      transaction,
    });

    await queryInterface.createTable('workspace_memberships', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      workspace_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'workspaces', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      role: { type: DataTypes.STRING(16), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'invited' },
      invited_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      invited_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('workspace_memberships', ['workspace_id', 'user_id'], {
      name: 'workspace_memberships_workspace_user_unique',
      unique: true,
      transaction,
    });
    await queryInterface.addIndex('workspace_memberships', ['user_id', 'status'], {
      name: 'workspace_memberships_user_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'workspace_memberships',
      'workspace_memberships_role_check',
      `role IN (${quotedList(ACCESS_ROLES)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'workspace_memberships',
      'workspace_memberships_status_check',
      `status IN (${quotedList(MEMBERSHIP_STATUSES)})`,
    );

    await queryInterface.addColumn('projects', 'workspace_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'workspaces', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    }, { transaction });
    await queryInterface.addIndex('projects', ['workspace_id', 'updated_at'], {
      name: 'projects_workspace_updated_idx',
      transaction,
    });

    await queryInterface.createTable('project_access', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      project_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      role: { type: DataTypes.STRING(16), allowNull: false },
      granted_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('project_access', ['project_id', 'user_id'], {
      name: 'project_access_project_user_unique',
      unique: true,
      transaction,
    });
    await queryInterface.addIndex('project_access', ['user_id'], {
      name: 'project_access_user_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'project_access',
      'project_access_role_check',
      `role IN (${quotedList(ACCESS_ROLES)})`,
    );

    /* ----------------------------------------------------------------- */
    /* Spatial: plans and scene placement                                 */
    /* ----------------------------------------------------------------- */
    await queryInterface.createTable('plans', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      project_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      name: { type: DataTypes.STRING(255), allowNull: false },
      // RESTRICT so a published plan cannot silently lose its image.
      asset_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'assets', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      coordinate_system: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'plan_normalized',
      },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('plans', ['project_id', 'sort_order'], {
      name: 'plans_project_sort_idx',
      transaction,
    });
    await queryInterface.addIndex('plans', ['asset_id'], {
      name: 'plans_asset_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'plans',
      'plans_coordinate_system_check',
      `coordinate_system IN (${quotedList(PLAN_COORDINATE_SYSTEMS)})`,
    );
    await addCheck(queryInterface, transaction, 'plans', 'plans_sort_order_check', 'sort_order >= 0');

    // Scene lookups by plan and by world position drive the map/plan views.
    await queryInterface.sequelize.query(
      `CREATE INDEX "scenes_plan_idx" ON "scenes" ((spatial_data->>'planId'))
       WHERE spatial_data ? 'planId'`,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `CREATE INDEX "scenes_geolocated_idx" ON "scenes" (project_id)
       WHERE spatial_data ? 'latitude'`,
      { transaction },
    );

    /* ----------------------------------------------------------------- */
    /* Advanced overlays                                                  */
    /* ----------------------------------------------------------------- */
    await queryInterface.createTable('overlays', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      scene_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'scenes', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      name: { type: DataTypes.STRING(240), allowNull: true },
      geometry_kind: { type: DataTypes.STRING(32), allowNull: false },
      geometry: { type: DataTypes.JSONB, allowNull: false },
      position: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      appearance: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      content: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      action: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      visibility_rules: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      extension_id: { type: DataTypes.STRING(128), allowNull: true },
      extension_version: { type: DataTypes.STRING(32), allowNull: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('overlays', ['scene_id', 'sort_order'], {
      name: 'overlays_scene_sort_idx',
      transaction,
    });
    await queryInterface.addIndex('overlays', ['extension_id', 'extension_version'], {
      name: 'overlays_extension_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'overlays',
      'overlays_geometry_kind_check',
      `geometry_kind IN (${quotedList(INTERACTION_GEOMETRY_KINDS)}) AND geometry_kind <> 'point'`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'overlays',
      'overlays_extension_pair_check',
      '(extension_id IS NULL) = (extension_version IS NULL)',
    );
    await addCheck(
      queryInterface,
      transaction,
      'overlays',
      'overlays_custom_extension_check',
      `geometry_kind <> 'custom' OR extension_id IS NOT NULL`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'overlays',
      'overlays_sort_order_check',
      'sort_order >= 0',
    );

    // Hotspots gained the same richer geometry family as overlays.
    await queryInterface.addColumn('hotspots', 'geometry_kind', {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'point',
    }, { transaction });
    await queryInterface.addColumn('hotspots', 'extension_id', {
      type: DataTypes.STRING(128),
      allowNull: true,
    }, { transaction });
    await queryInterface.addColumn('hotspots', 'extension_version', {
      type: DataTypes.STRING(32),
      allowNull: true,
    }, { transaction });
    await queryInterface.sequelize.query(
      `UPDATE "hotspots"
       SET geometry_kind = COALESCE(geometry->>'kind', 'point')`,
      { transaction },
    );
    await addCheck(
      queryInterface,
      transaction,
      'hotspots',
      'hotspots_geometry_kind_check',
      `geometry_kind IN (${quotedList(INTERACTION_GEOMETRY_KINDS)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'hotspots',
      'hotspots_extension_pair_check',
      '(extension_id IS NULL) = (extension_version IS NULL)',
    );
    await addCheck(
      queryInterface,
      transaction,
      'hotspots',
      'hotspots_custom_extension_check',
      `geometry_kind <> 'custom' OR extension_id IS NOT NULL`,
    );
    await queryInterface.addIndex('hotspots', ['extension_id', 'extension_version'], {
      name: 'hotspots_extension_idx',
      transaction,
    });

    /* ----------------------------------------------------------------- */
    /* Extension registry                                                 */
    /* ----------------------------------------------------------------- */
    await queryInterface.createTable('extensions', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      extension_id: { type: DataTypes.STRING(128), allowNull: false },
      version: { type: DataTypes.STRING(32), allowNull: false },
      name: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.STRING(2000), allowNull: true },
      supported_experience_types: { type: DataTypes.JSONB, allowNull: false },
      schema: { type: DataTypes.JSONB, allowNull: false },
      required_capabilities: { type: DataTypes.JSONB, allowNull: false },
      runtime_module: { type: DataTypes.STRING(160), allowNull: false },
      security_policy: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'draft' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('extensions', ['extension_id', 'version'], {
      name: 'extensions_id_version_unique',
      unique: true,
      transaction,
    });
    await queryInterface.addIndex('extensions', ['status'], {
      name: 'extensions_status_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'extensions',
      'extensions_status_check',
      `status IN (${quotedList(EXTENSION_STATUSES)})`,
    );

    /* ----------------------------------------------------------------- */
    /* Templates                                                          */
    /* ----------------------------------------------------------------- */
    await queryInterface.createTable('templates', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      owner_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      workspace_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'workspaces', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      name: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.STRING(2000), allowNull: true },
      schema_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      experience_type: { type: DataTypes.STRING(32), allowNull: false },
      canonical_blueprint: { type: DataTypes.JSONB, allowNull: false },
      asset_policy: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'omit' },
      visibility: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'platform' },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'published' },
      preview_asset_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'assets', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex(
      'templates',
      ['visibility', 'experience_type', 'status'],
      { name: 'templates_scope_type_idx', transaction },
    );
    await queryInterface.addIndex('templates', ['workspace_id'], {
      name: 'templates_workspace_idx',
      transaction,
    });
    await queryInterface.addIndex('templates', ['owner_id'], {
      name: 'templates_owner_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'templates',
      'templates_experience_type_check',
      `experience_type IN (${quotedList(PROJECT_TYPES)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'templates',
      'templates_visibility_check',
      `visibility IN (${quotedList(TEMPLATE_VISIBILITIES)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'templates',
      'templates_status_check',
      `status IN (${quotedList(TEMPLATE_STATUSES)})`,
    );
    await addCheck(
      queryInterface,
      transaction,
      'templates',
      'templates_asset_policy_check',
      `asset_policy IN (${quotedList(TEMPLATE_ASSET_POLICIES)})`,
    );
    // A scoped template must name its scope; a platform template must not.
    await addCheck(
      queryInterface,
      transaction,
      'templates',
      'templates_scope_check',
      `(visibility = 'platform' AND owner_id IS NULL AND workspace_id IS NULL)
       OR (visibility = 'workspace' AND workspace_id IS NOT NULL)
       OR (visibility = 'private' AND owner_id IS NOT NULL)`,
    );

    /* ----------------------------------------------------------------- */
    /* Publication access, embedding and viewer integration               */
    /* ----------------------------------------------------------------- */
    await queryInterface.addColumn('publications', 'viewer_integration_version', {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: 'unknown',
    }, { transaction });
    await queryInterface.addColumn('publications', 'embed_policy', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    }, { transaction });
    await queryInterface.addColumn('publications', 'pinned_extensions', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    }, { transaction });
    // Backfill from the manifest so existing revisions stay diagnosable.
    await queryInterface.sequelize.query(
      `UPDATE "publications"
       SET viewer_integration_version =
         COALESCE(compiled_manifest->>'viewerIntegrationVersion', 'unknown')
       WHERE compiled_manifest IS NOT NULL`,
      { transaction },
    );
    await queryInterface.addIndex('publications', ['viewer_integration_version', 'status'], {
      name: 'publications_viewer_integration_idx',
      transaction,
    });

    await queryInterface.createTable('publication_share_tokens', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      project_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Only the hash is stored: a database read never yields a usable link.
      token_hash: { type: DataTypes.STRING(64), allowNull: false },
      label: { type: DataTypes.STRING(160), allowNull: true },
      publication_revision: { type: DataTypes.INTEGER, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      last_used_at: { type: DataTypes.DATE, allowNull: true },
      created_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('publication_share_tokens', ['token_hash'], {
      name: 'publication_share_tokens_hash_unique',
      unique: true,
      transaction,
    });
    await queryInterface.addIndex('publication_share_tokens', ['project_id'], {
      name: 'publication_share_tokens_project_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'publication_share_tokens',
      'publication_share_tokens_revision_check',
      'publication_revision IS NULL OR publication_revision > 0',
    );

    await queryInterface.createTable('custom_domains', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      workspace_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'workspaces', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      hostname: { type: DataTypes.STRING(253), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
      verification_token: { type: DataTypes.STRING(64), allowNull: false },
      verified_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('custom_domains', ['hostname'], {
      name: 'custom_domains_hostname_unique',
      unique: true,
      transaction,
    });
    await queryInterface.addIndex('custom_domains', ['workspace_id'], {
      name: 'custom_domains_workspace_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'custom_domains',
      'custom_domains_status_check',
      `status IN (${quotedList(CUSTOM_DOMAIN_STATUSES)})`,
    );

    /* ----------------------------------------------------------------- */
    /* Audit trail                                                        */
    /* ----------------------------------------------------------------- */
    await queryInterface.createTable('audit_logs', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      action: { type: DataTypes.STRING(64), allowNull: false },
      // Identifiers, not foreign keys: the trail outlives what it describes.
      actor_user_id: { type: DataTypes.UUID, allowNull: true },
      workspace_id: { type: DataTypes.UUID, allowNull: true },
      project_id: { type: DataTypes.UUID, allowNull: true },
      entity_type: { type: DataTypes.STRING(32), allowNull: false },
      entity_id: { type: DataTypes.STRING(128), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('audit_logs', ['project_id', 'occurred_at'], {
      name: 'audit_logs_project_time_idx',
      transaction,
    });
    await queryInterface.addIndex('audit_logs', ['workspace_id', 'occurred_at'], {
      name: 'audit_logs_workspace_time_idx',
      transaction,
    });
    await queryInterface.addIndex('audit_logs', ['actor_user_id', 'occurred_at'], {
      name: 'audit_logs_actor_time_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'audit_logs',
      'audit_logs_action_check',
      `action IN (${quotedList(AUDIT_ACTIONS)})`,
    );

    /* ----------------------------------------------------------------- */
    /* Media families and analytics indexes                               */
    /* ----------------------------------------------------------------- */
    await dropCheck(queryInterface, transaction, 'assets', 'assets_media_type_check');
    await addCheck(
      queryInterface,
      transaction,
      'assets',
      'assets_media_type_check',
      `media_type IN (${quotedList(ASSET_MEDIA_TYPES)})`,
    );
    await dropCheck(queryInterface, transaction, 'asset_derivatives', 'asset_derivatives_kind_check');
    await addCheck(
      queryInterface,
      transaction,
      'asset_derivatives',
      'asset_derivatives_kind_check',
      `kind IN (${quotedList(ASSET_DERIVATIVE_KINDS)})`,
    );
    await dropCheck(queryInterface, transaction, 'media_job_stages', 'media_job_stages_derivative_check');
    await addCheck(
      queryInterface,
      transaction,
      'media_job_stages',
      'media_job_stages_derivative_check',
      `derivative_version > 0 AND attempt >= 0 AND (derivative_kind IS NULL OR derivative_kind IN (${quotedList(ASSET_DERIVATIVE_KINDS)}))`,
    );

    await dropCheck(queryInterface, transaction, 'runtime_events', 'runtime_events_name_check');
    await addCheck(
      queryInterface,
      transaction,
      'runtime_events',
      'runtime_events_name_check',
      `event_name IN (${quotedList(RUNTIME_EVENT_NAMES)})`,
    );
    // Creator analytics reads by experience, event and time window.
    await queryInterface.addIndex(
      'runtime_events',
      ['experience_id', 'event_name', 'occurred_at'],
      { name: 'runtime_events_experience_name_time_idx', transaction },
    );
    await queryInterface.addIndex(
      'runtime_events',
      ['experience_id', 'session_id'],
      { name: 'runtime_events_experience_session_idx', transaction },
    );

    // Large-tour scene definition lookups by publication revision.
    await queryInterface.addIndex(
      'published_scene_definitions',
      ['publication_id', 'scene_id'],
      { name: 'published_scene_definitions_publication_scene_idx', transaction },
    );
  });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.removeIndex(
      'published_scene_definitions',
      'published_scene_definitions_publication_scene_idx',
      { transaction },
    );
    await queryInterface.removeIndex(
      'runtime_events',
      'runtime_events_experience_session_idx',
      { transaction },
    );
    await queryInterface.removeIndex(
      'runtime_events',
      'runtime_events_experience_name_time_idx',
      { transaction },
    );
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

    await dropCheck(queryInterface, transaction, 'media_job_stages', 'media_job_stages_derivative_check');
    await addCheck(
      queryInterface,
      transaction,
      'media_job_stages',
      'media_job_stages_derivative_check',
      `derivative_version > 0 AND attempt >= 0 AND (derivative_kind IS NULL OR derivative_kind IN (${quotedList(LEGACY_ASSET_DERIVATIVE_KINDS)}))`,
    );
    await dropCheck(queryInterface, transaction, 'asset_derivatives', 'asset_derivatives_kind_check');
    await addCheck(
      queryInterface,
      transaction,
      'asset_derivatives',
      'asset_derivatives_kind_check',
      `kind IN (${quotedList(LEGACY_ASSET_DERIVATIVE_KINDS)})`,
    );
    await dropCheck(queryInterface, transaction, 'assets', 'assets_media_type_check');
    await addCheck(
      queryInterface,
      transaction,
      'assets',
      'assets_media_type_check',
      `media_type IN (${quotedList(LEGACY_ASSET_MEDIA_TYPES)})`,
    );

    await queryInterface.dropTable('audit_logs', { transaction });
    await queryInterface.dropTable('custom_domains', { transaction });
    await queryInterface.dropTable('publication_share_tokens', { transaction });
    await queryInterface.removeIndex(
      'publications',
      'publications_viewer_integration_idx',
      { transaction },
    );
    await queryInterface.removeColumn('publications', 'pinned_extensions', { transaction });
    await queryInterface.removeColumn('publications', 'embed_policy', { transaction });
    await queryInterface.removeColumn('publications', 'viewer_integration_version', { transaction });
    await queryInterface.dropTable('templates', { transaction });
    await queryInterface.dropTable('extensions', { transaction });

    await queryInterface.removeIndex('hotspots', 'hotspots_extension_idx', { transaction });
    await dropCheck(queryInterface, transaction, 'hotspots', 'hotspots_custom_extension_check');
    await dropCheck(queryInterface, transaction, 'hotspots', 'hotspots_extension_pair_check');
    await dropCheck(queryInterface, transaction, 'hotspots', 'hotspots_geometry_kind_check');
    await queryInterface.removeColumn('hotspots', 'extension_version', { transaction });
    await queryInterface.removeColumn('hotspots', 'extension_id', { transaction });
    await queryInterface.removeColumn('hotspots', 'geometry_kind', { transaction });
    await queryInterface.dropTable('overlays', { transaction });

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS "scenes_geolocated_idx"', { transaction });
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS "scenes_plan_idx"', { transaction });
    await queryInterface.dropTable('plans', { transaction });

    await queryInterface.dropTable('project_access', { transaction });
    await queryInterface.removeIndex('projects', 'projects_workspace_updated_idx', { transaction });
    await queryInterface.removeColumn('projects', 'workspace_id', { transaction });
    await queryInterface.dropTable('workspace_memberships', { transaction });
    await queryInterface.dropTable('workspaces', { transaction });
  });
}
