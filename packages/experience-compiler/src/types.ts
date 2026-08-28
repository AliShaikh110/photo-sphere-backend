import type {
  AdjacentScenePreloadPolicyConfig,
  CanonicalAsset,
  CanonicalProject,
  CompileTarget,
  CompiledExperienceManifest,
  CompiledPublishedSceneDefinition,
  CompiledSceneIndexEntry,
  ExtensionRegistrySnapshot,
  PublicationVisibility,
  RuntimeCachePolicyConfig,
  TourStrategyPolicyConfig,
  ValidationIssue,
  ViewerIntegrationOutput,
} from '@sphere/experience-schema';
import type { CapabilityRegistry } from '@sphere/capability-registry';
import type { MediaDeliveryPolicy } from './media-delivery-policy';

/**
 * The compiled runtime contract lives in the shared schema package; it is
 * re-exported here so a caller needs one import to compile and to read the
 * result.
 */
export * from '@sphere/experience-schema';
export * from './media-delivery-policy';

/**
 * Everything about the compile that varies by deployment, resolved by the
 * caller. Passing policy in rather than reading configuration is what makes
 * two compiles of the same experience produce the same bytes.
 */
export interface CompilerPolicy {
  readonly media: MediaDeliveryPolicy;
  readonly tour: TourStrategyPolicyConfig;
  readonly preload: AdjacentScenePreloadPolicyConfig;
  readonly cache: RuntimeCachePolicyConfig;
}

/** The compile inputs shared by the class API and the pure function API. */
export interface CompileExperienceInput {
  readonly project: CanonicalProject;
  readonly assets: readonly CanonicalAsset[];
  readonly target: CompileTarget;
  readonly publicationRevision?: number;
  readonly visibility?: PublicationVisibility;
  /** Required for revision-pinned progressive scene URLs in published output. */
  readonly publicationSlug?: string;
  /** Enables custom interaction validation and runtime module allow-listing. */
  readonly extensions?: ExtensionRegistrySnapshot;
  /** The capability registry to resolve against; the built-in one by default. */
  readonly capabilities?: CapabilityRegistry;
}

/**
 * The pure compiler's input. Every value that varies per request is passed in:
 * the experience, the asset snapshots it references, the capability registry
 * snapshot to resolve against, the delivery and runtime policy, and the
 * versions the output must be labelled with.
 */
export interface CompilerInput extends CompileExperienceInput {
  readonly policy?: Partial<CompilerPolicy>;
  readonly viewerIntegrationVersion?: string;
  readonly schemaVersion?: number;
}

/**
 * A finding a creator can act on, in product language.
 *
 * Codes and paths are stable, so an editor can point at the field a finding
 * belongs to rather than showing a wall of text.
 */
export interface CompilerDiagnostic extends ValidationIssue {
  readonly severity: 'error' | 'warning';
}

export interface CompileResult {
  readonly manifest: CompiledExperienceManifest;
  /** Compiled scenes for progressive fetch; empty for a draft preview. */
  readonly sceneDefinitions: readonly CompiledPublishedSceneDefinition[];
  /** Every scene index entry, including any the manifest omits when segmented. */
  readonly sceneIndex: readonly CompiledSceneIndexEntry[];
  readonly viewerIntegration: ViewerIntegrationOutput;
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly contentHash: string;
  readonly compilerVersion: string;
  readonly schemaVersion: number;
  readonly viewerIntegrationVersion: string;
}

/** The outcome of a compile a caller does not want to handle as an exception. */
export type CompileOutcome =
  | { readonly ok: true; readonly result: CompileResult }
  | { readonly ok: false; readonly diagnostics: readonly CompilerDiagnostic[] };
