import { randomUUID } from 'node:crypto';
import { DataTypes, Sequelize } from 'sequelize';
import { QueryTypes } from 'sequelize';
import type { QueryInterface, Transaction } from 'sequelize';

interface MigrationContext {
  context: QueryInterface;
}

const now = Sequelize.literal('CURRENT_TIMESTAMP');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LegacySceneRow {
  id: string;
  project_id: string;
  connections: unknown;
}

interface LegacyHotspotRow {
  id: string;
  scene_id: string;
}

interface PersistedConnectionRow {
  id: string;
  source_scene_id: string;
  target_scene_id: string;
  trigger_hotspot_id: string | null;
  label: string | null;
  content: unknown;
  importance: number | null;
  preload_hint: 'none' | 'normal' | 'high' | null;
  created_at: Date;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function legacyConnectionError(sceneId: string, index: number, message: string): Error {
  return new Error(`Cannot migrate scenes.connections for scene ${sceneId} at index ${index}: ${message}`);
}

function legacyConnectionArray(value: unknown, sceneId: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the actionable migration error.
    }
  }
  throw new Error(`Cannot migrate scenes.connections for scene ${sceneId}: value is not an array.`);
}

async function migrateLegacySceneConnections(
  queryInterface: QueryInterface,
  transaction: Transaction,
): Promise<void> {
  const scenes = await queryInterface.sequelize.query<LegacySceneRow>(
    'SELECT id, project_id, connections FROM scenes',
    { type: QueryTypes.SELECT, transaction },
  );
  const hotspots = await queryInterface.sequelize.query<LegacyHotspotRow>(
    'SELECT id, scene_id FROM hotspots',
    { type: QueryTypes.SELECT, transaction },
  );
  const sceneProjects = new Map(scenes.map((scene) => [scene.id, scene.project_id]));
  const hotspotScenes = new Map(hotspots.map((hotspot) => [hotspot.id, hotspot.scene_id]));
  const connectionIds = new Set<string>();
  const inserts: Record<string, unknown>[] = [];

  for (const scene of scenes) {
    const connections = legacyConnectionArray(scene.connections, scene.id);
    for (const [index, value] of connections.entries()) {
      const connection = record(value);
      if (!connection) throw legacyConnectionError(scene.id, index, 'connection must be an object.');
      const sourceSceneId = connection.sourceSceneId;
      if (sourceSceneId !== undefined && sourceSceneId !== scene.id) {
        throw legacyConnectionError(scene.id, index, 'sourceSceneId does not match its containing scene.');
      }
      const targetSceneId = connection.targetSceneId;
      if (typeof targetSceneId !== 'string' || !uuidPattern.test(targetSceneId)) {
        throw legacyConnectionError(scene.id, index, 'targetSceneId must be a UUID.');
      }
      if (targetSceneId === scene.id || sceneProjects.get(targetSceneId) !== scene.project_id) {
        throw legacyConnectionError(scene.id, index, 'targetSceneId must reference another scene in the project.');
      }

      const suppliedId = connection.id;
      if (suppliedId !== undefined && (typeof suppliedId !== 'string' || !uuidPattern.test(suppliedId))) {
        throw legacyConnectionError(scene.id, index, 'id must be a UUID when supplied.');
      }
      const id = typeof suppliedId === 'string' ? suppliedId : randomUUID();
      if (connectionIds.has(id)) throw legacyConnectionError(scene.id, index, 'id is duplicated.');
      connectionIds.add(id);

      const trigger = connection.triggerHotspotId;
      if (trigger !== undefined && trigger !== null
        && (typeof trigger !== 'string'
          || !uuidPattern.test(trigger)
          || hotspotScenes.get(trigger) !== scene.id)) {
        throw legacyConnectionError(
          scene.id,
          index,
          'triggerHotspotId must reference a hotspot in the source scene.',
        );
      }
      const label = connection.label;
      if (label !== undefined && label !== null
        && (typeof label !== 'string' || label.length > 240)) {
        throw legacyConnectionError(scene.id, index, 'label must be a string of at most 240 characters.');
      }
      const content = connection.content;
      if (content !== undefined && record(content) === undefined) {
        throw legacyConnectionError(scene.id, index, 'content must be an object.');
      }
      const importance = connection.importance;
      if (importance !== undefined && importance !== null
        && (!Number.isInteger(importance) || Number(importance) < 0 || Number(importance) > 100)) {
        throw legacyConnectionError(scene.id, index, 'importance must be an integer from 0 through 100.');
      }
      const preloadHint = connection.preloadHint;
      if (preloadHint !== undefined && preloadHint !== null
        && !['none', 'normal', 'high'].includes(String(preloadHint))) {
        throw legacyConnectionError(scene.id, index, 'preloadHint must be none, normal, or high.');
      }
      inserts.push({
        id,
        source_scene_id: scene.id,
        target_scene_id: targetSceneId,
        trigger_hotspot_id: trigger ?? null,
        label: label ?? null,
        content: content ?? {},
        importance: importance ?? null,
        preload_hint: preloadHint ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }
  if (inserts.length > 0) {
    await queryInterface.bulkInsert('scene_connections', inserts, { transaction });
  }
  await queryInterface.removeColumn('scenes', 'connections', { transaction });
}

async function restoreLegacySceneConnections(
  queryInterface: QueryInterface,
  transaction: Transaction,
): Promise<void> {
  await queryInterface.addColumn('scenes', 'connections', {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  }, { transaction });
  const connections = await queryInterface.sequelize.query<PersistedConnectionRow>(
    `SELECT id, source_scene_id, target_scene_id, trigger_hotspot_id, label,
            content, importance, preload_hint, created_at
       FROM scene_connections
      ORDER BY source_scene_id, created_at, id`,
    { type: QueryTypes.SELECT, transaction },
  );
  const byScene = new Map<string, Record<string, unknown>[]>();
  for (const connection of connections) {
    const group = byScene.get(connection.source_scene_id) ?? [];
    group.push({
      id: connection.id,
      sourceSceneId: connection.source_scene_id,
      targetSceneId: connection.target_scene_id,
      ...(connection.trigger_hotspot_id === null
        ? {}
        : { triggerHotspotId: connection.trigger_hotspot_id }),
      ...(connection.label === null ? {} : { label: connection.label }),
      content: connection.content,
      ...(connection.importance === null ? {} : { importance: connection.importance }),
      ...(connection.preload_hint === null ? {} : { preloadHint: connection.preload_hint }),
      createdAt: connection.created_at,
    });
    byScene.set(connection.source_scene_id, group);
  }
  for (const [sceneId, connectionsForScene] of byScene) {
    await queryInterface.sequelize.query(
      'UPDATE scenes SET connections = CAST(:connections AS jsonb) WHERE id = :sceneId',
      {
        replacements: { connections: JSON.stringify(connectionsForScene), sceneId },
        transaction,
      },
    );
  }
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

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.createTable('scene_connections', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      source_scene_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'scenes', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      target_scene_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'scenes', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      trigger_hotspot_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'hotspots', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      label: { type: DataTypes.STRING(240), allowNull: true },
      content: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      importance: { type: DataTypes.INTEGER, allowNull: true },
      preload_hint: { type: DataTypes.STRING(16), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex('scene_connections', ['source_scene_id'], {
      name: 'scene_connections_source_idx',
      transaction,
    });
    await queryInterface.addIndex('scene_connections', ['target_scene_id'], {
      name: 'scene_connections_target_idx',
      transaction,
    });
    await queryInterface.addIndex('scene_connections', ['trigger_hotspot_id'], {
      name: 'scene_connections_trigger_hotspot_idx',
      transaction,
    });
    await addCheck(
      queryInterface,
      transaction,
      'scene_connections',
      'scene_connections_distinct_scenes_check',
      'source_scene_id <> target_scene_id',
    );
    await addCheck(
      queryInterface,
      transaction,
      'scene_connections',
      'scene_connections_importance_check',
      'importance IS NULL OR (importance >= 0 AND importance <= 100)',
    );
    await addCheck(
      queryInterface,
      transaction,
      'scene_connections',
      'scene_connections_preload_hint_check',
      `preload_hint IS NULL OR preload_hint IN ('none', 'normal', 'high')`,
    );
    await migrateLegacySceneConnections(queryInterface, transaction);

    await queryInterface.createTable('published_scene_definitions', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      publication_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'publications', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      project_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      publication_revision: { type: DataTypes.INTEGER, allowNull: false },
      // This is an immutable copied identity, not a foreign key to mutable draft data.
      scene_id: { type: DataTypes.UUID, allowNull: false },
      compiled_scene_version: { type: DataTypes.STRING(64), allowNull: false },
      compiled_scene: { type: DataTypes.JSONB, allowNull: false },
      checksum: { type: DataTypes.STRING(64), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    }, { transaction });
    await queryInterface.addIndex(
      'published_scene_definitions',
      ['project_id', 'publication_revision', 'scene_id'],
      {
        name: 'published_scene_definitions_project_revision_scene_unique',
        unique: true,
        transaction,
      },
    );
    await addCheck(
      queryInterface,
      transaction,
      'published_scene_definitions',
      'published_scene_definitions_revision_check',
      'publication_revision > 0',
    );
    await addCheck(
      queryInterface,
      transaction,
      'published_scene_definitions',
      'published_scene_definitions_checksum_check',
      `checksum ~ '^[a-f0-9]{64}$'`,
    );
  });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.dropTable('published_scene_definitions', { transaction });
    await restoreLegacySceneConnections(queryInterface, transaction);
    await queryInterface.dropTable('scene_connections', { transaction });
  });
}
