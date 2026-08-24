export type GpanoMetadata = {
  projectionType?: string;
  usePanoramaViewer?: boolean;
  croppedAreaImageWidthPixels?: number;
  croppedAreaImageHeightPixels?: number;
  fullPanoWidthPixels?: number;
  fullPanoHeightPixels?: number;
  croppedAreaLeftPixels?: number;
  croppedAreaTopPixels?: number;
  poseHeadingDegrees?: number;
  posePitchDegrees?: number;
  poseRollDegrees?: number;
  initialViewHeadingDegrees?: number;
  initialViewPitchDegrees?: number;
  initialViewFovDegrees?: number;
};

const numericFields: Record<string, keyof GpanoMetadata> = {
  CroppedAreaImageWidthPixels: 'croppedAreaImageWidthPixels',
  CroppedAreaImageHeightPixels: 'croppedAreaImageHeightPixels',
  FullPanoWidthPixels: 'fullPanoWidthPixels',
  FullPanoHeightPixels: 'fullPanoHeightPixels',
  CroppedAreaLeftPixels: 'croppedAreaLeftPixels',
  CroppedAreaTopPixels: 'croppedAreaTopPixels',
  PoseHeadingDegrees: 'poseHeadingDegrees',
  PosePitchDegrees: 'posePitchDegrees',
  PoseRollDegrees: 'poseRollDegrees',
  InitialViewHeadingDegrees: 'initialViewHeadingDegrees',
  InitialViewPitchDegrees: 'initialViewPitchDegrees',
  InitialHorizontalFOVDegrees: 'initialViewFovDegrees'
};

function extractValue(source: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attribute = new RegExp(`GPano:${escaped}\\s*=\\s*["']([^"']+)["']`, 'i').exec(source)?.[1];
  if (attribute !== undefined) return attribute;
  return new RegExp(`<GPano:${escaped}[^>]*>([^<]+)</GPano:${escaped}>`, 'i').exec(source)?.[1];
}

export function extractGpanoMetadata(bytes: Buffer): GpanoMetadata | undefined {
  const source = bytes.toString('latin1');
  if (!source.includes('GPano:')) return undefined;
  const result: GpanoMetadata = {};
  const projection = extractValue(source, 'ProjectionType');
  if (projection) result.projectionType = projection;
  const useViewer = extractValue(source, 'UsePanoramaViewer');
  if (useViewer !== undefined) result.usePanoramaViewer = useViewer.toLowerCase() === 'true';
  for (const [xmpField, resultField] of Object.entries(numericFields)) {
    const raw = extractValue(source, xmpField);
    if (raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) {
      (result as Record<string, unknown>)[resultField] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
