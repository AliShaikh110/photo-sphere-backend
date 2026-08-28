import type { AssetDerivative } from '@alishaikh110/experience-schema';
import type { CompiledTileLevel } from './types';

export interface TiledPanoramaMetadata {
  readonly tileSize: number;
  readonly levels: readonly CompiledTileLevel[];
}

export function readTiledPanoramaMetadata(
  derivative: Pick<AssetDerivative, 'kind' | 'metadata'>,
): TiledPanoramaMetadata | undefined {
  if (derivative.kind !== 'tiledLevels') return undefined;
  const metadata = record(derivative.metadata);
  const tileSize = positiveInteger(metadata?.tileSize);
  if (tileSize === undefined || !Array.isArray(metadata?.levels) || metadata.levels.length === 0) {
    return undefined;
  }

  const levels: CompiledTileLevel[] = [];
  const levelTileCounts = new Map<number, number>();
  for (const candidate of metadata.levels) {
    const level = record(candidate);
    const parsed = {
      level: nonNegativeInteger(level?.level),
      width: positiveInteger(level?.width),
      height: positiveInteger(level?.height),
      columns: positiveInteger(level?.columns),
      rows: positiveInteger(level?.rows),
    };
    if (Object.values(parsed).some((value) => value === undefined)) return undefined;
    const compiledLevel = parsed as CompiledTileLevel;
    const tileCount = positiveInteger(level?.tileCount);
    if (tileCount !== compiledLevel.columns * compiledLevel.rows) return undefined;
    levels.push(compiledLevel);
    levelTileCounts.set(compiledLevel.level, tileCount);
  }

  levels.sort((left, right) => left.level - right.level);
  if (new Set(levels.map((level) => level.level)).size !== levels.length) return undefined;
  if (!Array.isArray(metadata.tiles)) return undefined;
  const expectedTileCount = [...levelTileCounts.values()].reduce((total, count) => total + count, 0);
  if (metadata.tiles.length !== expectedTileCount
    || positiveInteger(metadata.tileCount) !== expectedTileCount) return undefined;

  const levelsById = new Map(levels.map((level) => [level.level, level]));
  const coordinates = new Set<string>();
  for (const candidate of metadata.tiles) {
    const tile = record(candidate);
    const levelId = nonNegativeInteger(tile?.level);
    const x = nonNegativeInteger(tile?.x);
    const y = nonNegativeInteger(tile?.y);
    const width = positiveInteger(tile?.width);
    const height = positiveInteger(tile?.height);
    const levelWidth = positiveInteger(tile?.levelWidth);
    const levelHeight = positiveInteger(tile?.levelHeight);
    const level = levelId === undefined ? undefined : levelsById.get(levelId);
    if (
      level === undefined
      || x === undefined
      || y === undefined
      || width === undefined
      || height === undefined
      || levelWidth !== level.width
      || levelHeight !== level.height
      || x >= level.columns
      || y >= level.rows
      || width !== Math.min(tileSize, level.width - x * tileSize)
      || height !== Math.min(tileSize, level.height - y * tileSize)
      || typeof tile?.storageKey !== 'string'
      || tile.storageKey.length === 0
      || typeof tile.mimeType !== 'string'
      || tile.mimeType.length === 0
      || positiveInteger(tile.sizeBytes) === undefined
      || typeof tile.checksumSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(tile.checksumSha256)
    ) return undefined;
    const coordinate = `${levelId}:${x}:${y}`;
    if (coordinates.has(coordinate)) return undefined;
    coordinates.add(coordinate);
  }
  return Object.freeze({ tileSize, levels: Object.freeze(levels) });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}
