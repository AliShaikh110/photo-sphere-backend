import {
  ExperienceCompilationError,
  ExperienceCompiler,
  createViewerIntegrationAdapter,
  type CompileExperienceInput,
  type MediaUrlResolver
} from '../compiler';
import { config } from '../config';
import { referenceExperiences, type ReferenceExperience } from './reference-experiences';

export interface ReferenceExpectationResult {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
}

export interface ReferenceExperienceResult {
  readonly experienceId: string;
  readonly title: string;
  readonly covers: string;
  readonly passed: boolean;
  readonly compileDurationMs: number;
  readonly manifestBytes: number;
  readonly sceneDefinitionCount: number;
  readonly expectations: readonly ReferenceExpectationResult[];
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export interface ReferenceSuiteResult {
  readonly viewerIntegrationVersion: string;
  readonly passed: boolean;
  readonly totalCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly durationMs: number;
  readonly results: readonly ReferenceExperienceResult[];
}

/**
 * Media URLs in the suite must be deterministic: the run compares behavior
 * between integration versions, so a signed or time-varying URL would make two
 * identical runs look different.
 */
const deterministicMediaUrlResolver: MediaUrlResolver = {
  resolve: ({ derivative, access, experienceId, publicationRevision }) =>
    access === 'public'
      ? `/api/v1/publications/${experienceId}/${publicationRevision ?? 1}/media/${derivative.id}`
      : `/api/v1/media/${derivative.id}`
};

function toCompileInput(experience: ReferenceExperience): CompileExperienceInput {
  return {
    project: experience.project,
    assets: experience.assets,
    target: experience.target,
    ...(experience.target === 'publication'
      ? {
        publicationRevision: 1,
        visibility: experience.visibility,
        publicationSlug: experience.project.publication?.slug ?? 'reference-experience'
      }
      : {})
  };
}

async function runOne(
  compiler: ExperienceCompiler,
  experience: ReferenceExperience
): Promise<ReferenceExperienceResult> {
  const startedAt = Date.now();
  try {
    const bundle = await compiler.compileBundle(toCompileInput(experience));
    const manifest = bundle.manifest as unknown as Record<string, unknown>;
    const expectations = experience.expectations.map((expectation) => {
      let passed = false;
      try {
        passed = expectation.check(manifest);
      } catch {
        passed = false;
      }
      return { id: expectation.id, description: expectation.description, passed };
    });
    return {
      experienceId: experience.id,
      title: experience.title,
      covers: experience.covers,
      passed: expectations.every((expectation) => expectation.passed),
      compileDurationMs: Date.now() - startedAt,
      manifestBytes: Buffer.byteLength(JSON.stringify(bundle.manifest), 'utf8'),
      sceneDefinitionCount: bundle.sceneDefinitions.length,
      expectations
    };
  } catch (error) {
    const compilationError = error instanceof ExperienceCompilationError ? error : undefined;
    return {
      experienceId: experience.id,
      title: experience.title,
      covers: experience.covers,
      passed: false,
      compileDurationMs: Date.now() - startedAt,
      manifestBytes: 0,
      sceneDefinitionCount: 0,
      expectations: experience.expectations.map((expectation) => ({
        id: expectation.id,
        description: expectation.description,
        passed: false
      })),
      failureCode: compilationError?.issues[0]?.code ?? 'COMPILATION_FAILED',
      failureMessage:
        compilationError?.issues[0]?.message
        ?? (error instanceof Error ? error.message : 'Compilation failed.')
    };
  }
}

/**
 * Compiles every reference experience through the given viewer integration
 * version. This is the promotion gate: a version that cannot render the
 * reference set must never become the version customer publications compile
 * against.
 */
export async function runReferenceExperienceSuite(
  viewerIntegrationVersion: string
): Promise<ReferenceSuiteResult> {
  const startedAt = Date.now();
  const compiler = new ExperienceCompiler({
    mediaUrlResolver: deterministicMediaUrlResolver,
    viewerIntegrationAdapter: createViewerIntegrationAdapter(viewerIntegrationVersion),
    tourStrategyPolicy: config.tourStrategyPolicy
  });
  const results: ReferenceExperienceResult[] = [];
  for (const experience of referenceExperiences()) {
    results.push(await runOne(compiler, experience));
  }
  const passedCount = results.filter((result) => result.passed).length;
  return {
    viewerIntegrationVersion,
    passed: passedCount === results.length,
    totalCount: results.length,
    passedCount,
    failedCount: results.length - passedCount,
    durationMs: Date.now() - startedAt,
    results
  };
}
