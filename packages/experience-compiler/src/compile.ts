import { createViewerIntegrationAdapter } from '@sphere/viewer-integration';

import { contentHash } from './content-hash';
import { ExperienceCompilationError, ExperienceCompiler } from './experience-compiler';
import { preflightExperience } from './preflight';
import type {
  CompileExperienceInput,
  CompileOutcome,
  CompileResult,
  CompilerDiagnostic,
  CompilerInput,
} from './types';

/**
 * The compiler build. It labels compiled output and is logged beside a drift
 * alert, so a mismatch between a client-side compile and the server's can be
 * traced to a version rather than guessed at.
 */
export const COMPILER_VERSION = 'experience-compiler-1' as const;

function compilerFor(input: CompilerInput): ExperienceCompiler {
  const policy = input.policy ?? {};
  return new ExperienceCompiler({
    ...(policy.media === undefined ? {} : { mediaDeliveryPolicy: policy.media }),
    ...(policy.tour === undefined ? {} : { tourStrategyPolicy: policy.tour }),
    ...(policy.preload === undefined ? {} : { preloadPolicy: policy.preload }),
    ...(policy.cache === undefined ? {} : { cachePolicy: policy.cache }),
    ...(input.viewerIntegrationVersion === undefined
      ? {}
      : {
        viewerIntegrationAdapter:
          createViewerIntegrationAdapter(input.viewerIntegrationVersion),
      }),
  });
}

function toInput(input: CompilerInput): CompileExperienceInput {
  return {
    project: input.project,
    assets: input.assets,
    target: input.target,
    ...(input.publicationRevision === undefined
      ? {}
      : { publicationRevision: input.publicationRevision }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.publicationSlug === undefined
      ? {}
      : { publicationSlug: input.publicationSlug }),
    ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
    ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
  };
}

/**
 * Findings a creator can act on that did not stop the compile.
 *
 * An optional capability that resolved to a fallback is the case that matters
 * for an editor: the experience compiles, but something the creator asked for
 * is not what a visitor will get, and the editor should be able to say so.
 */
function appliedFallbackDiagnostics(
  input: CompileExperienceInput,
): CompilerDiagnostic[] {
  const preflight = preflightExperience(input);
  return preflight.capabilityResolution.fallbacks.map((fallback) => ({
    severity: 'warning' as const,
    code: 'CAPABILITY_FALLBACK_APPLIED',
    message: fallback.message,
    entityType: 'project' as const,
    entityId: input.project.id,
    path: `capabilities.${fallback.capabilityId}`,
    retryable: false,
  }));
}

function errorDiagnostics(
  error: ExperienceCompilationError,
): CompilerDiagnostic[] {
  return error.issues.map((issue) => ({ ...issue, severity: issue.severity ?? 'error' }));
}

/**
 * Compiles a canonical Experience into a runtime manifest.
 *
 * Pure and synchronous: the same input produces byte-identical output, on a
 * server or in a browser. Every value that varies per request — asset
 * snapshots, capability registry, delivery and runtime policy, the versions to
 * label the output with — arrives in `input`.
 *
 * Throws `ExperienceCompilationError` when the experience cannot be compiled;
 * `tryCompile` returns the same findings as diagnostics instead.
 */
export function compile(input: CompilerInput): CompileResult {
  const compileInput = toInput(input);
  const bundle = compilerFor(input).compileBundle(compileInput);
  const sceneIndex = bundle.sceneIndex ?? [];
  return Object.freeze({
    manifest: bundle.manifest,
    sceneDefinitions: bundle.sceneDefinitions,
    sceneIndex,
    viewerIntegration: bundle.manifest.viewerIntegration,
    diagnostics: Object.freeze(appliedFallbackDiagnostics(compileInput)),
    contentHash: contentHash({
      manifest: bundle.manifest,
      sceneDefinitions: bundle.sceneDefinitions,
      sceneIndex,
    }),
    compilerVersion: COMPILER_VERSION,
    schemaVersion: input.schemaVersion ?? input.project.schemaVersion,
    viewerIntegrationVersion: bundle.manifest.viewerIntegrationVersion,
  });
}

/** Compiles without throwing, for a caller that renders findings rather than errors. */
export function tryCompile(input: CompilerInput): CompileOutcome {
  try {
    return { ok: true, result: compile(input) };
  } catch (error) {
    if (!(error instanceof ExperienceCompilationError)) throw error;
    return { ok: false, diagnostics: Object.freeze(errorDiagnostics(error)) };
  }
}
