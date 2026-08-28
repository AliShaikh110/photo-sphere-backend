import {
  DEFAULT_MEDIA_DELIVERY_POLICY,
  ExperienceCompilationError,
  compile,
  contentHash,
  type CompilerInput
} from '@alishaikh110/experience-compiler';
import { DEFAULT_TOUR_STRATEGY_POLICY } from '@alishaikh110/experience-schema';
import { sha256, stableJson } from '../../apps/api/src/utils/hash';
import type { GoldenScenario } from './scenarios';

/**
 * The viewer integration the freeze is recorded against. Pinning it here keeps
 * a golden fixture comparable across environments whose configured version
 * differs, and makes a version bump an explicit, reviewable re-record.
 */
export const GOLDEN_VIEWER_INTEGRATION_VERSION = 'psv-5.14.3-adapter-2';

export interface GoldenArtifact {
  readonly id: string;
  readonly description: string;
  readonly viewerIntegrationVersion: string;
  readonly input: Record<string, unknown>;
  readonly outcome: 'compiled' | 'rejected';
  readonly manifest: unknown;
  readonly viewerIntegration: unknown;
  readonly sceneDefinitions: unknown;
  readonly sceneIndex: unknown;
  readonly diagnostics: unknown;
  readonly hashes: Record<string, string>;
}

export function goldenCompileInput(scenario: GoldenScenario): CompilerInput {
  return {
    project: scenario.project,
    assets: scenario.assets,
    target: scenario.target,
    viewerIntegrationVersion: GOLDEN_VIEWER_INTEGRATION_VERSION,
    // Delivery locations and runtime policy are pinned rather than read from
    // configuration, so a golden fixture stays byte-stable everywhere.
    policy: {
      media: DEFAULT_MEDIA_DELIVERY_POLICY,
      tour: DEFAULT_TOUR_STRATEGY_POLICY
    },
    ...(scenario.target === 'publication'
      ? {
        publicationRevision: scenario.publicationRevision ?? 1,
        visibility: scenario.visibility,
        ...(scenario.publicationSlug === undefined
          ? {}
          : { publicationSlug: scenario.publicationSlug })
      }
      : {})
  };
}

/**
 * The deterministic hash of one compiled output.
 *
 * Key order in the compiled objects is an implementation detail, so the hash is
 * taken over a key-sorted rendering: two runs that produce the same experience
 * hash the same, and a genuine behaviour change cannot hide behind ordering.
 */
export function goldenContentHash(bundle: {
  manifest: unknown;
  sceneDefinitions: unknown;
  sceneIndex?: unknown;
}): string {
  return contentHash({
    manifest: bundle.manifest,
    sceneDefinitions: bundle.sceneDefinitions,
    sceneIndex: bundle.sceneIndex ?? []
  });
}

export function recordGoldenArtifact(scenario: GoldenScenario): GoldenArtifact {
  const input = goldenCompileInput(scenario);
  const recordedInput: Record<string, unknown> = {
    target: input.target,
    visibility: scenario.visibility,
    ...(input.publicationRevision === undefined
      ? {}
      : { publicationRevision: input.publicationRevision }),
    ...(input.publicationSlug === undefined ? {} : { publicationSlug: input.publicationSlug }),
    schemaVersion: scenario.project.schemaVersion,
    project: scenario.project,
    assets: scenario.assets
  };
  const identity = {
    id: scenario.id,
    description: scenario.description,
    viewerIntegrationVersion: GOLDEN_VIEWER_INTEGRATION_VERSION,
    input: recordedInput
  };

  let result;
  try {
    result = compile(input);
  } catch (error) {
    if (!(error instanceof ExperienceCompilationError)) throw error;
    // A rejection is frozen too: the codes, paths and alternatives a creator is
    // shown are as much a contract as a manifest is.
    const diagnostics = error.issues;
    return {
      ...identity,
      outcome: 'rejected',
      manifest: null,
      viewerIntegration: null,
      sceneDefinitions: [],
      sceneIndex: [],
      diagnostics,
      hashes: {
        input: sha256(stableJson(recordedInput)),
        diagnostics: sha256(stableJson(diagnostics))
      }
    };
  }

  return {
    ...identity,
    outcome: 'compiled',
    manifest: result.manifest,
    viewerIntegration: result.viewerIntegration,
    sceneDefinitions: result.sceneDefinitions,
    sceneIndex: result.sceneIndex,
    diagnostics: [],
    hashes: {
      input: sha256(stableJson(recordedInput)),
      manifest: sha256(stableJson(result.manifest)),
      viewerIntegration: sha256(stableJson(result.viewerIntegration)),
      sceneDefinitions: sha256(stableJson(result.sceneDefinitions)),
      sceneIndex: sha256(stableJson(result.sceneIndex)),
      content: result.contentHash
    }
  };
}

/** The exact bytes a golden fixture file holds. */
export function serializeGoldenArtifact(artifact: GoldenArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}
