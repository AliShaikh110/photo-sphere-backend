import type {
  AssetDerivative,
  AssetDerivativeKind,
  CanonicalAsset,
  CanonicalInitialView,
  CanonicalProject,
  CanonicalProjectSettings,
  CanonicalViewLimits,
  JsonObject,
  SphericalPosition,
} from '../domain/types';
import type { CompiledPanoramaCrop } from './panorama-metadata';

export type { CompiledPanoramaCrop } from './panorama-metadata';

export const COMPILED_MANIFEST_VERSION = 1 as const;

export type CompileTarget = 'preview' | 'publication';
export type PublicationVisibility = 'public' | 'private';
export type MediaAccess = 'protected' | 'public';

export interface CompileExperienceInput {
  readonly project: CanonicalProject;
  readonly assets: readonly CanonicalAsset[];
  readonly target: CompileTarget;
  readonly publicationRevision?: number;
  readonly visibility?: PublicationVisibility;
}

export interface MediaUrlResolutionRequest {
  readonly experienceId: string;
  readonly assetId: string;
  readonly derivative: AssetDerivative;
  readonly access: MediaAccess;
  readonly target: CompileTarget;
  readonly publicationRevision?: number;
}

export interface ResolvedMediaUrl {
  readonly url: string;
  readonly expiresAt?: string;
}

export type MediaUrlResolution = string | ResolvedMediaUrl;

export interface MediaUrlResolver {
  resolve(request: MediaUrlResolutionRequest): MediaUrlResolution | Promise<MediaUrlResolution>;
}

export interface CompiledMediaReference {
  readonly assetId: string;
  readonly derivativeId: string;
  readonly kind: AssetDerivativeKind;
  readonly version: number;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly url: string;
  readonly access: MediaAccess;
  readonly expiresAt?: string;
}

export interface CompiledPanoramaMedia {
  readonly assetId: string;
  readonly projection: 'equirectangular' | 'cropped_equirectangular';
  readonly crop?: CompiledPanoramaCrop;
  readonly base: CompiledMediaReference;
  readonly primary: CompiledMediaReference;
}

export interface CompiledInformationButton {
  readonly label: string;
  readonly url: string;
}

export type CompiledHotspotAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'showInformation' }
  | { readonly kind: 'openUrl'; readonly url: string }
  | {
      readonly kind: 'openAsset';
      readonly media: CompiledMediaReference;
    }
  | { readonly kind: 'goToScene'; readonly sceneId: string };

export interface CompiledHotspotContent {
  readonly title?: string;
  readonly description?: string;
  readonly bodyHtml?: string;
  readonly tooltip?: string;
  readonly buttonLabel?: string;
  readonly externalUrl?: string;
  readonly imageAssetId?: string;
  readonly image?: CompiledMediaReference;
  readonly properties: JsonObject;
}

export interface CompiledHotspotAppearance {
  readonly label?: string;
  readonly iconAssetId?: string;
  readonly color?: string;
  readonly emphasis?: 'normal' | 'prominent' | 'subtle';
  readonly properties: JsonObject;
  readonly icon?: CompiledMediaReference;
}

export interface CompiledHotspot {
  readonly id: string;
  readonly geometry: { readonly kind: 'point' };
  readonly position: SphericalPosition;
  readonly appearance?: CompiledHotspotAppearance;
  readonly content?: CompiledHotspotContent;
  readonly action: CompiledHotspotAction;
  readonly enabled: boolean;
  readonly visibilityRules: JsonObject;
}

export interface CompiledScene {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
  readonly panorama: CompiledPanoramaMedia;
  readonly initialView: CanonicalInitialView;
  readonly viewLimits?: CanonicalViewLimits;
  readonly hotspots: readonly CompiledHotspot[];
  readonly overlays: readonly JsonObject[];
  readonly connections: readonly JsonObject[];
  readonly spatialData: JsonObject;
  readonly runtimeHints: JsonObject;
}

export interface CompiledBranding {
  readonly companyName?: string;
  readonly logoAssetId?: string;
  readonly faviconAssetId?: string;
  readonly watermarkAssetId?: string;
  readonly primaryColor?: string;
  readonly welcomeMessage?: string;
  readonly loadingMessage?: string;
  readonly properties: JsonObject;
  readonly logo?: CompiledMediaReference;
  readonly favicon?: CompiledMediaReference;
  readonly watermark?: CompiledMediaReference;
}

export interface RuntimeCapabilityDeclaration {
  readonly id: string;
  readonly required: boolean;
  readonly fallback?: string;
}

export interface RuntimeDeclarations {
  readonly modules: readonly string[];
  readonly fallbackPolicy: {
    readonly panorama: 'low-resolution-base-then-standard-web';
    readonly optionalCapabilities: 'continue-without-capability';
  };
}

export const BASELINE_TELEMETRY_EVENTS = [
  'experience_load_started',
  'first_panorama_visible',
  'time_to_interactive',
  'hotspot_clicked',
  'asset_failed',
  'viewer_error',
  'experience_exited',
] as const;

export interface CompiledTelemetryMetadata {
  readonly enabled: true;
  readonly experienceId: string;
  readonly projectRevision: number;
  readonly publicationRevision: number | null;
  readonly viewerIntegrationVersion: string;
  readonly events: readonly (typeof BASELINE_TELEMETRY_EVENTS)[number][];
}

/** This opaque JSON is renderer-specific and may only be created by an adapter. */
export interface ViewerIntegrationOutput {
  readonly rendererId: string;
  readonly viewerIntegrationVersion: string;
  readonly config: JsonObject;
}

export interface ViewerIntegrationInput {
  readonly initialSceneId: string;
  readonly settings: CanonicalProjectSettings;
  readonly branding: CompiledBranding;
  readonly scenes: readonly CompiledScene[];
}

export interface ViewerIntegrationAdapter {
  readonly viewerIntegrationVersion: string;
  adapt(input: ViewerIntegrationInput): ViewerIntegrationOutput;
}

export interface CompiledExperienceManifest {
  readonly manifestVersion: typeof COMPILED_MANIFEST_VERSION;
  readonly schemaVersion: number;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly experienceType: 'image360';
  readonly projectRevision: number;
  readonly publicationRevision: number | null;
  readonly target: CompileTarget;
  readonly visibility: PublicationVisibility;
  readonly viewerIntegrationVersion: string;
  readonly initialSceneId: string;
  readonly settings: CanonicalProjectSettings;
  readonly branding: CompiledBranding;
  readonly scenes: readonly CompiledScene[];
  readonly capabilities: readonly RuntimeCapabilityDeclaration[];
  readonly runtime: RuntimeDeclarations;
  readonly telemetry: CompiledTelemetryMetadata;
  readonly viewerIntegration: ViewerIntegrationOutput;
}
