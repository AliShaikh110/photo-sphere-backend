import type {
  AssetDerivative,
  CanonicalAsset,
  CanonicalBranding,
  CanonicalHotspot,
  CanonicalProjectSettings,
  JsonObject,
  JsonValue,
} from '../domain/types';
import type { ValidationIssue } from '../domain/validation';
import { sanitizePlainText, sanitizeRichHtml } from '../security/html-sanitizer';
import { validateSafeUrl } from '../security/url-validator';
import {
  requirePanoramaDerivatives,
  selectPreferredReadyDerivative,
} from './derivative-selector';
import { preflightExperience } from './preflight';
import { readPanoramaCrop } from './panorama-metadata';
import {
  BASELINE_TELEMETRY_EVENTS,
  COMPILED_MANIFEST_VERSION,
} from './types';
import type {
  CompileExperienceInput,
  CompiledBranding,
  CompiledExperienceManifest,
  CompiledHotspot,
  CompiledHotspotAction,
  CompiledHotspotAppearance,
  CompiledHotspotContent,
  CompiledMediaReference,
  CompiledScene,
  MediaAccess,
  MediaUrlResolution,
  MediaUrlResolutionRequest,
  MediaUrlResolver,
  PublicationVisibility,
  RuntimeCapabilityDeclaration,
  ViewerIntegrationAdapter,
} from './types';
import { PhotoSphereViewerIntegrationAdapter } from './viewer-integration-adapter';

export interface ExperienceCompilerDependencies {
  readonly mediaUrlResolver: MediaUrlResolver;
  readonly viewerIntegrationAdapter?: ViewerIntegrationAdapter;
  readonly viewerIntegrationVersion?: string;
}

interface ResolutionContext {
  readonly input: CompileExperienceInput;
  readonly access: MediaAccess;
  readonly cache: Map<string, Promise<CompiledMediaReference>>;
}

interface IssueLocation {
  readonly entityType: ValidationIssue['entityType'];
  readonly entityId: string;
  readonly path: string;
}

export class ExperienceCompilationError extends Error {
  readonly code = 'EXPERIENCE_COMPILATION_FAILED';
  readonly issues: readonly ValidationIssue[];
  readonly entityId?: string;
  readonly path?: string;
  readonly retryable: boolean;

  constructor(issues: readonly ValidationIssue[]) {
    super('The Experience could not be compiled.');
    this.name = 'ExperienceCompilationError';
    this.issues = Object.freeze([...issues]);
    const first = issues[0];
    if (first?.entityId !== undefined) {
      this.entityId = first.entityId;
    }
    if (first?.path !== undefined) {
      this.path = first.path;
    }
    this.retryable = issues.length > 0 && issues.every((issue) => issue.retryable);
  }
}

/** Shared compilation boundary used unchanged by draft preview and publication. */
export class ExperienceCompiler {
  private readonly mediaUrlResolver: MediaUrlResolver;
  private readonly viewerIntegrationAdapter: ViewerIntegrationAdapter;

  constructor(dependencies: ExperienceCompilerDependencies) {
    this.mediaUrlResolver = dependencies.mediaUrlResolver;
    this.viewerIntegrationAdapter = dependencies.viewerIntegrationAdapter
      ?? new PhotoSphereViewerIntegrationAdapter(dependencies.viewerIntegrationVersion);
    if (dependencies.viewerIntegrationVersion !== undefined
      && this.viewerIntegrationAdapter.viewerIntegrationVersion
        !== dependencies.viewerIntegrationVersion) {
      throw new Error('The injected viewer integration version does not match the adapter.');
    }
  }

  preflight(input: CompileExperienceInput): ReturnType<typeof preflightExperience> {
    return preflightExperience(input);
  }

  async compile(input: CompileExperienceInput): Promise<CompiledExperienceManifest> {
    const preflight = this.preflight(input);
    if (!preflight.valid) {
      throw new ExperienceCompilationError(preflight.issues);
    }

    const visibility = resolveVisibility(input);
    const access: MediaAccess = input.target === 'preview' || visibility === 'private'
      ? 'protected'
      : 'public';
    const context: ResolutionContext = { input, access, cache: new Map() };
    const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
    const initialSceneId = input.project.scenes.find((scene) => scene.isPrimary)?.id
      ?? input.project.scenes[0]!.id;
    const settings = deepFreeze(compileSettings(input.project.settings));
    const branding = deepFreeze(await this.compileBranding(
      input.project.branding,
      input.project.id,
      assetsById,
      context,
    ));

    const scenes: CompiledScene[] = [];
    for (const [sceneIndex, scene] of input.project.scenes.entries()) {
      const panoramaAsset = assetsById.get(scene.panoramaAssetId!)!;
      const derivatives = requirePanoramaDerivatives(panoramaAsset);
      const base = await this.resolveDerivative(
        panoramaAsset,
        derivatives.lowResolutionBase,
        context,
        {
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
        },
      );
      const primary = await this.resolveDerivative(
        panoramaAsset,
        derivatives.standardWeb,
        context,
        {
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
        },
      );

      const hotspots: CompiledHotspot[] = [];
      for (const [hotspotIndex, hotspot] of scene.hotspots.entries()) {
        hotspots.push(await this.compileHotspot(
          hotspot,
          `scenes[${sceneIndex}].hotspots[${hotspotIndex}]`,
          assetsById,
          context,
        ));
      }

      // Preflight narrows this at runtime; this cast only reflects that invariant to TypeScript.
      const projection = panoramaAsset.projection as 'equirectangular' | 'cropped_equirectangular';
      const initialView = scene.initialView ?? {
        headingDegrees: 0,
        pitchDegrees: 0,
        horizontalFovDegrees: 90,
      };
      scenes.push({
        id: scene.id,
        name: sanitizePlainText(scene.name),
        sortOrder: scene.sortOrder ?? sceneIndex,
        isPrimary: scene.id === initialSceneId,
        panorama: {
          assetId: panoramaAsset.id,
          projection,
          ...(projection === 'cropped_equirectangular'
            ? { crop: readPanoramaCrop(panoramaAsset)! }
            : {}),
          base,
          primary,
        },
        initialView: { ...initialView },
        ...(scene.viewLimits === undefined ? {} : { viewLimits: { ...scene.viewLimits } }),
        hotspots,
        overlays: cloneJsonArray(scene.overlays ?? []),
        connections: cloneJsonArray(scene.connections ?? []),
        spatialData: cloneJsonObject(scene.spatialData ?? {}),
        runtimeHints: cloneJsonObject(scene.runtimeHints ?? {}),
      });
    }

    const frozenScenes = deepFreeze(scenes);
    const capabilities = deepFreeze(buildCapabilities(frozenScenes));
    const runtimeModules = deepFreeze(buildRuntimeModules(capabilities));
    const adapterOutput = this.viewerIntegrationAdapter.adapt({
      initialSceneId,
      settings,
      branding,
      scenes: frozenScenes,
    });
    if (adapterOutput.viewerIntegrationVersion
      !== this.viewerIntegrationAdapter.viewerIntegrationVersion) {
      throw new ExperienceCompilationError([{
        code: 'VIEWER_INTEGRATION_VERSION_MISMATCH',
        message: 'The viewer integration adapter emitted an inconsistent version.',
        entityType: 'project',
        entityId: input.project.id,
        path: 'viewerIntegrationVersion',
        retryable: false,
      }]);
    }

    const publicationRevision = input.target === 'publication'
      ? input.publicationRevision!
      : null;
    const viewerIntegrationVersion = this.viewerIntegrationAdapter.viewerIntegrationVersion;
    const manifest: CompiledExperienceManifest = {
      manifestVersion: COMPILED_MANIFEST_VERSION,
      schemaVersion: input.project.schemaVersion,
      experienceId: input.project.id,
      experienceName: sanitizePlainText(input.project.name),
      experienceType: 'image360',
      projectRevision: input.project.revision,
      publicationRevision,
      target: input.target,
      visibility,
      viewerIntegrationVersion,
      initialSceneId,
      settings,
      branding,
      scenes: frozenScenes,
      capabilities,
      runtime: {
        modules: runtimeModules,
        fallbackPolicy: {
          panorama: 'low-resolution-base-then-standard-web',
          optionalCapabilities: 'continue-without-capability',
        },
      },
      telemetry: {
        enabled: true,
        experienceId: input.project.id,
        projectRevision: input.project.revision,
        publicationRevision,
        viewerIntegrationVersion,
        events: [...BASELINE_TELEMETRY_EVENTS],
      },
      viewerIntegration: adapterOutput,
    };

    return deepFreeze(manifest);
  }

  private async compileBranding(
    branding: CanonicalBranding,
    projectId: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): Promise<CompiledBranding> {
    const properties: Record<string, JsonValue> = {
      ...(branding.companyName === undefined
        ? {}
        : { companyName: sanitizePlainText(branding.companyName) }),
      ...(branding.logoAssetId === undefined ? {} : { logoAssetId: branding.logoAssetId }),
      ...(branding.faviconAssetId === undefined ? {} : { faviconAssetId: branding.faviconAssetId }),
      ...(branding.watermarkAssetId === undefined ? {} : { watermarkAssetId: branding.watermarkAssetId }),
      ...(branding.primaryColor === undefined ? {} : { primaryColor: branding.primaryColor }),
      ...(branding.welcomeMessage === undefined
        ? {}
        : { welcomeMessage: sanitizeRichHtml(branding.welcomeMessage) }),
      ...(branding.loadingMessage === undefined
        ? {}
        : { loadingMessage: sanitizeRichHtml(branding.loadingMessage) }),
    };
    const compiled: CompiledBranding = {
      ...(branding.companyName === undefined
        ? {}
        : { companyName: sanitizePlainText(branding.companyName) }),
      ...(branding.logoAssetId === undefined ? {} : { logoAssetId: branding.logoAssetId }),
      ...(branding.faviconAssetId === undefined
        ? {}
        : { faviconAssetId: branding.faviconAssetId }),
      ...(branding.watermarkAssetId === undefined
        ? {}
        : { watermarkAssetId: branding.watermarkAssetId }),
      ...(branding.primaryColor === undefined ? {} : { primaryColor: branding.primaryColor }),
      ...(branding.welcomeMessage === undefined
        ? {}
        : { welcomeMessage: sanitizeRichHtml(branding.welcomeMessage) }),
      ...(branding.loadingMessage === undefined
        ? {}
        : { loadingMessage: sanitizeRichHtml(branding.loadingMessage) }),
      properties,
    };

    const resolved: {
      logo?: CompiledMediaReference;
      favicon?: CompiledMediaReference;
      watermark?: CompiledMediaReference;
    } = {};
    for (const [field, outputField] of [
      ['logoAssetId', 'logo'],
      ['faviconAssetId', 'favicon'],
      ['watermarkAssetId', 'watermark'],
    ] as const) {
      const assetId = branding[field];
      if (assetId === undefined) {
        continue;
      }
      const asset = assetsById.get(assetId);
      if (asset === undefined || asset.processingStatus !== 'ready') continue;
      const derivative = selectPreferredReadyDerivative(asset);
      if (derivative === undefined) continue;
      resolved[outputField] = await this.resolveDerivative(asset, derivative, context, {
        entityType: 'branding',
        entityId: projectId,
        path: `branding.${field}`,
      });
    }
    return { ...compiled, ...resolved };
  }

  private async compileHotspot(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): Promise<CompiledHotspot> {
    const appearance = await this.compileHotspotAppearance(
      hotspot,
      path,
      assetsById,
      context,
    );
    const content = await this.compileHotspotContent(hotspot, path, assetsById, context);
    const action = await this.compileHotspotAction(
      hotspot,
      path,
      assetsById,
      context,
    );

    return {
      id: hotspot.id,
      geometry: { kind: 'point' },
      position: { ...hotspot.position },
      ...(appearance === undefined ? {} : { appearance }),
      ...(content === undefined ? {} : { content }),
      action,
      enabled: hotspot.visibilityRules?.enabled ?? true,
      visibilityRules: hotspot.visibilityRules?.enabled === undefined
        ? {}
        : { enabled: hotspot.visibilityRules.enabled },
    };
  }

  private async compileHotspotAppearance(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): Promise<CompiledHotspotAppearance | undefined> {
    const appearance = hotspot.appearance;
    if (appearance === undefined) {
      return undefined;
    }
    const compiled: CompiledHotspotAppearance = {
      ...(appearance.label === undefined
        ? {}
        : { label: sanitizePlainText(appearance.label) }),
      ...(appearance.iconAssetId === undefined ? {} : { iconAssetId: appearance.iconAssetId }),
      ...(appearance.color === undefined ? {} : { color: appearance.color }),
      ...(appearance.emphasis === undefined ? {} : { emphasis: appearance.emphasis }),
      properties: {
        ...(appearance.label === undefined ? {} : { label: sanitizePlainText(appearance.label) }),
        ...(appearance.iconAssetId === undefined ? {} : { iconAssetId: appearance.iconAssetId }),
        ...(appearance.color === undefined ? {} : { color: appearance.color }),
        ...(appearance.emphasis === undefined ? {} : { emphasis: appearance.emphasis }),
      },
    };
    if (appearance.iconAssetId === undefined) {
      return compiled;
    }
    const asset = assetsById.get(appearance.iconAssetId)!;
    const derivative = selectPreferredReadyDerivative(asset)!;
    const icon = await this.resolveDerivative(asset, derivative, context, {
      entityType: 'hotspot',
      entityId: hotspot.id,
      path: `${path}.appearance.iconAssetId`,
    });
    return { ...compiled, icon };
  }

  private async compileHotspotContent(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): Promise<CompiledHotspotContent | undefined> {
    const content = hotspot.content;
    if (content === undefined) {
      return undefined;
    }
    const properties: Record<string, JsonValue> = {
      ...(content.title === undefined ? {} : { title: sanitizePlainText(content.title) }),
      ...(content.description === undefined
        ? {}
        : { description: sanitizePlainText(content.description) }),
      ...(content.bodyHtml === undefined
        ? {}
        : { bodyHtml: sanitizeRichHtml(content.bodyHtml) }),
      ...(content.tooltip === undefined ? {} : { tooltip: sanitizePlainText(content.tooltip) }),
      ...(content.buttonLabel === undefined
        ? {}
        : { buttonLabel: sanitizePlainText(content.buttonLabel) }),
      ...(content.externalUrl === undefined
        ? {}
        : { externalUrl: normalizeTrustedUrl(content.externalUrl) }),
      ...(content.imageAssetId === undefined ? {} : { imageAssetId: content.imageAssetId }),
    };
    const image = content.imageAssetId === undefined
      ? undefined
      : await this.resolveDisplayAsset(
        content.imageAssetId,
        assetsById,
        context,
        {
          entityType: 'hotspot',
          entityId: hotspot.id,
          path: `${path}.content.imageAssetId`,
        },
      );
    return {
      ...(content.title === undefined ? {} : { title: sanitizePlainText(content.title) }),
      ...(content.description === undefined
        ? {}
        : { description: sanitizePlainText(content.description) }),
      ...(content.bodyHtml === undefined
        ? {}
        : { bodyHtml: sanitizeRichHtml(content.bodyHtml) }),
      ...(content.tooltip === undefined ? {} : { tooltip: sanitizePlainText(content.tooltip) }),
      ...(content.buttonLabel === undefined
        ? {}
        : { buttonLabel: sanitizePlainText(content.buttonLabel) }),
      ...(content.externalUrl === undefined
        ? {}
        : { externalUrl: normalizeTrustedUrl(content.externalUrl) }),
      ...(content.imageAssetId === undefined ? {} : { imageAssetId: content.imageAssetId }),
      ...(image === undefined ? {} : { image }),
      properties,
    };
  }

  private async compileHotspotAction(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): Promise<CompiledHotspotAction> {
    const action = hotspot.action;
    switch (action.kind) {
      case 'none':
        return { kind: 'none' };
      case 'showInformation':
        return { kind: 'showInformation' };
      case 'openUrl':
        return { kind: 'openUrl', url: normalizeTrustedUrl(action.url) };
      case 'goToScene':
        return { kind: 'goToScene', sceneId: action.sceneId };
      case 'openAsset': {
        const media = await this.resolveDisplayAsset(
          action.assetId,
          assetsById,
          context,
          {
            entityType: 'hotspot',
            entityId: hotspot.id,
            path: `${path}.action.assetId`,
          },
        );
        return { kind: 'openAsset', media };
      }
    }
  }

  private async resolveDisplayAsset(
    assetId: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
    location: IssueLocation,
  ): Promise<CompiledMediaReference> {
    const asset = assetsById.get(assetId)!;
    const derivative = selectPreferredReadyDerivative(asset)!;
    return this.resolveDerivative(asset, derivative, context, location);
  }

  private resolveDerivative(
    asset: CanonicalAsset,
    derivative: AssetDerivative,
    context: ResolutionContext,
    location: IssueLocation,
  ): Promise<CompiledMediaReference> {
    const cacheKey = `${context.access}:${asset.id}:${derivative.id}:${derivative.version}`;
    const cached = context.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const resolution = this.resolveDerivativeUncached(asset, derivative, context, location);
    context.cache.set(cacheKey, resolution);
    return resolution;
  }

  private async resolveDerivativeUncached(
    asset: CanonicalAsset,
    derivative: AssetDerivative,
    context: ResolutionContext,
    location: IssueLocation,
  ): Promise<CompiledMediaReference> {
    const request: MediaUrlResolutionRequest = {
      experienceId: context.input.project.id,
      assetId: asset.id,
      derivative,
      access: context.access,
      target: context.input.target,
      ...(context.input.publicationRevision === undefined
        ? {}
        : { publicationRevision: context.input.publicationRevision }),
    };

    let resolution: MediaUrlResolution;
    try {
      resolution = await this.mediaUrlResolver.resolve(request);
    } catch {
      throw new ExperienceCompilationError([{
        code: 'MEDIA_URL_RESOLUTION_FAILED',
        message: 'A protected media reference could not be generated.',
        ...location,
        retryable: true,
      }]);
    }

    const rawUrl = typeof resolution === 'string' ? resolution : resolution.url;
    const url = validateSafeUrl(rawUrl, { allowInternalRelative: true });
    if (!url.valid) {
      throw new ExperienceCompilationError([{
        code: 'MEDIA_URL_INVALID',
        message: 'The media resolver returned a URL outside the delivery policy.',
        ...location,
        retryable: false,
      }]);
    }
    const expiresAt = typeof resolution === 'string' ? undefined : resolution.expiresAt;
    return Object.freeze({
      assetId: asset.id,
      derivativeId: derivative.id,
      kind: derivative.kind,
      version: derivative.version,
      mimeType: derivative.mimeType,
      width: derivative.width,
      height: derivative.height,
      url: url.normalizedUrl,
      access: context.access,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
  }
}

export async function compileExperience(
  input: CompileExperienceInput,
  dependencies: ExperienceCompilerDependencies,
): Promise<CompiledExperienceManifest> {
  return new ExperienceCompiler(dependencies).compile(input);
}

export const compileExperienceManifest = compileExperience;

export function createMediaUrlResolver(
  resolve: MediaUrlResolver['resolve'],
): MediaUrlResolver {
  return { resolve };
}

function compileSettings(
  settings: CanonicalProjectSettings,
): CanonicalProjectSettings {
  const compiled: Record<string, JsonValue> = {};
  if (settings.appearance !== undefined) {
    compiled.appearance = {
      ...(settings.appearance.theme === undefined ? {} : { theme: settings.appearance.theme }),
      ...(settings.appearance.backgroundColor === undefined
        ? {}
        : { backgroundColor: settings.appearance.backgroundColor }),
      ...(settings.appearance.primaryColor === undefined
        ? {}
        : { primaryColor: settings.appearance.primaryColor }),
      ...(settings.appearance.hotspotStyle === undefined
        ? {}
        : { hotspotStyle: sanitizePlainText(settings.appearance.hotspotStyle) }),
      ...(settings.appearance.typography === undefined
        ? {}
        : { typography: sanitizePlainText(settings.appearance.typography) }),
    };
  }
  if (settings.navigation !== undefined) {
    compiled.navigation = {
      ...(settings.navigation.mouse === undefined ? {} : { mouse: settings.navigation.mouse }),
      ...(settings.navigation.touch === undefined ? {} : { touch: settings.navigation.touch }),
      ...(settings.navigation.zoom === undefined ? {} : { zoom: settings.navigation.zoom }),
      ...(settings.navigation.keyboard === undefined ? {} : { keyboard: settings.navigation.keyboard }),
      ...(settings.navigation.fullscreen === undefined ? {} : { fullscreen: settings.navigation.fullscreen }),
      ...(settings.navigation.navigationButtons === undefined
        ? {}
        : { navigationButtons: settings.navigation.navigationButtons }),
    };
  }
  if (settings.information !== undefined) {
    compiled.information = {
      ...(settings.information.title === undefined
        ? {}
        : { title: sanitizePlainText(settings.information.title) }),
      ...(settings.information.description === undefined
        ? {}
        : { description: sanitizePlainText(settings.information.description) }),
      ...(settings.information.bodyHtml === undefined
        ? {}
        : { bodyHtml: sanitizeRichHtml(settings.information.bodyHtml) }),
      ...(settings.information.externalUrl === undefined
        ? {}
        : { externalUrl: normalizeTrustedUrl(settings.information.externalUrl) }),
    };
  }
  return compiled as CanonicalProjectSettings;
}

function normalizeTrustedUrl(url: string): string {
  const validation = validateSafeUrl(url, { allowInternalRelative: true });
  if (!validation.valid) {
    // Preflight guarantees this path; retain a fail-closed invariant if called independently.
    throw new Error('Attempted to compile an unsafe URL.');
  }
  return validation.normalizedUrl;
}

function resolveVisibility(input: CompileExperienceInput): PublicationVisibility {
  if (input.target === 'preview') {
    return 'private';
  }
  const visibility = input.visibility ?? input.project.publication?.visibility;
  return visibility === 'public' ? 'public' : 'private';
}

function buildCapabilities(scenes: readonly CompiledScene[]): RuntimeCapabilityDeclaration[] {
  const declarations = new Map<string, RuntimeCapabilityDeclaration>();
  declarations.set('panorama.image', {
    id: 'panorama.image',
    required: true,
    fallback: 'low-resolution-base',
  });
  declarations.set('media.progressive-baseline', {
    id: 'media.progressive-baseline',
    required: true,
  });
  for (const scene of scenes) {
    for (const hotspot of scene.hotspots) {
      declarations.set('hotspot.point', { id: 'hotspot.point', required: false });
      if (hotspot.action.kind === 'showInformation') {
        declarations.set('content.information', { id: 'content.information', required: false });
      } else if (hotspot.action.kind === 'goToScene') {
        declarations.set('navigation.scene', { id: 'navigation.scene', required: false });
      } else if (hotspot.action.kind === 'openUrl') {
        declarations.set('link.safe-navigation', {
          id: 'link.safe-navigation',
          required: false,
        });
      } else if (hotspot.action.kind === 'openAsset') {
        declarations.set('content.image', { id: 'content.image', required: false });
      }
    }
  }
  return [...declarations.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function buildRuntimeModules(capabilities: readonly RuntimeCapabilityDeclaration[]): string[] {
  const modules = new Set(['experience-core', 'panorama-image']);
  for (const capability of capabilities) {
    if (capability.id === 'hotspot.point') {
      modules.add('point-hotspots');
    } else if (capability.id === 'content.information') {
      modules.add('information-panels');
    } else if (capability.id === 'navigation.scene') {
      modules.add('scene-navigation');
    } else if (capability.id === 'content.image') {
      modules.add('image-content');
    }
  }
  return [...modules].sort((left, right) => left.localeCompare(right));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function cloneJsonObject(value: JsonObject): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function cloneJsonArray(value: readonly JsonObject[]): JsonObject[] {
  return JSON.parse(JSON.stringify(value)) as JsonObject[];
}
