import {
  ExperienceCompilationError,
  ExperienceCompiler,
  createViewerIntegrationAdapter,
  type CompileExperienceInput,
  type MediaUrlResolver
} from '../../apps/api/src/compiler';
import { DEFAULT_TOUR_STRATEGY_POLICY } from '../../apps/api/src/runtime';
import { sha256, stableJson } from '../../apps/api/src/utils/hash';
import type { GoldenScenario } from './scenarios';

/**
 * The viewer integration the freeze is recorded against. Pinning it here keeps
 * a golden fixture comparable across environments whose configured version
 * differs, and makes a version bump an explicit, reviewable re-record.
 */
export const GOLDEN_VIEWER_INTEGRATION_VERSION = 'psv-5.14.3-adapter-2';

/**
 * The logical delivery locations the compiler emits.
 *
 * They carry no credential and never vary between two runs: signing a URL is a
 * server-side hydration step performed after compilation, so a golden fixture
 * stays byte-stable and the compiled output stays safe to produce in a browser.
 */
export const GOLDEN_MEDIA_URL_RESOLVER: MediaUrlResolver = {
  resolve: ({ derivative, access, experienceId, publicationRevision }) =>
    access === 'public'
      ? `/api/v1/publications/${experienceId}/${publicationRevision ?? 1}/media/${derivative.id}`
      : `/api/v1/media/${derivative.id}`
};

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

export function goldenCompileInput(scenario: GoldenScenario): CompileExperienceInput {
  return {
    project: scenario.project,
    assets: scenario.assets,
    target: scenario.target,
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
  return sha256(stableJson({
    manifest: bundle.manifest,
    sceneDefinitions: bundle.sceneDefinitions,
    sceneIndex: bundle.sceneIndex ?? []
  }));
}

function createGoldenCompiler(): ExperienceCompiler {
  return new ExperienceCompiler({
    mediaUrlResolver: GOLDEN_MEDIA_URL_RESOLVER,
    viewerIntegrationAdapter: createViewerIntegrationAdapter(GOLDEN_VIEWER_INTEGRATION_VERSION),
    tourStrategyPolicy: DEFAULT_TOUR_STRATEGY_POLICY
  });
}

export async function recordGoldenArtifact(scenario: GoldenScenario): Promise<GoldenArtifact> {
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

  try {
    const bundle = await createGoldenCompiler().compileBundle(input);
    const sceneIndex = bundle.sceneIndex ?? [];
    return {
      id: scenario.id,
      description: scenario.description,
      viewerIntegrationVersion: GOLDEN_VIEWER_INTEGRATION_VERSION,
      input: recordedInput,
      outcome: 'compiled',
      manifest: bundle.manifest,
      viewerIntegration: bundle.manifest.viewerIntegration,
      sceneDefinitions: bundle.sceneDefinitions,
      sceneIndex,
      diagnostics: [],
      hashes: {
        input: sha256(stableJson(recordedInput)),
        manifest: sha256(stableJson(bundle.manifest)),
        viewerIntegration: sha256(stableJson(bundle.manifest.viewerIntegration)),
        sceneDefinitions: sha256(stableJson(bundle.sceneDefinitions)),
        sceneIndex: sha256(stableJson(sceneIndex)),
        content: goldenContentHash({ ...bundle, sceneIndex })
      }
    };
  } catch (error) {
    if (!(error instanceof ExperienceCompilationError)) throw error;
    const diagnostics = error.issues;
    return {
      id: scenario.id,
      description: scenario.description,
      viewerIntegrationVersion: GOLDEN_VIEWER_INTEGRATION_VERSION,
      input: recordedInput,
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
}

/** The exact bytes a golden fixture file holds. */
export function serializeGoldenArtifact(artifact: GoldenArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}
