import type { QueryInterface, Transaction } from 'sequelize';

interface MigrationContext {
  context: QueryInterface;
}

/**
 * A migration owns its own snapshot of a vocabulary, so widening the shared
 * constant later never rewrites the DDL this revision applied.
 */
const MEDIA_JOB_STAGE_NAMES = [
  'inspect',
  'thumbnail',
  'lowResolutionBase',
  'standardWeb',
  'tiledLevels',
  'poster',
  'transcodeDesktop',
  'transcodeMobile',
  'derivatives',
  'finalize',
] as const;

/** The stage vocabulary before the image pipeline reported per derivative. */
const LEGACY_MEDIA_JOB_STAGE_NAMES = [
  'inspect',
  'poster',
  'transcodeDesktop',
  'transcodeMobile',
  'derivatives',
  'finalize',
] as const;

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

/**
 * Admits the panorama pipeline's per-derivative stage names.
 *
 * Image processing previously reported only a coarse job stage, so a panorama
 * asset exposed no per-stage record while a video asset did. Widening the
 * vocabulary lets one derivative's failure stay individually diagnosable for
 * both media families.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await dropCheck(queryInterface, transaction, 'media_job_stages', 'media_job_stages_stage_check');
    await addCheck(
      queryInterface,
      transaction,
      'media_job_stages',
      'media_job_stages_stage_check',
      `stage IN (${quotedList(MEDIA_JOB_STAGE_NAMES)})`,
    );
  });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    // Stage rows are job diagnostics, not customer Experience data, so rows
    // written under the wider vocabulary are dropped rather than rewritten.
    await queryInterface.sequelize.query(
      `DELETE FROM "media_job_stages" WHERE stage NOT IN (${quotedList(LEGACY_MEDIA_JOB_STAGE_NAMES)})`,
      { transaction },
    );
    await dropCheck(queryInterface, transaction, 'media_job_stages', 'media_job_stages_stage_check');
    await addCheck(
      queryInterface,
      transaction,
      'media_job_stages',
      'media_job_stages_stage_check',
      `stage IN (${quotedList(LEGACY_MEDIA_JOB_STAGE_NAMES)})`,
    );
  });
}
