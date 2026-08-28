/**
 * Minimal, dependency-free container readers for the two web-delivery families
 * the platform ingests. They exist so metadata inspection (dimensions,
 * duration, frame rate, codecs, audio presence, rotation and 360 projection
 * markers) never depends on an external transcoder being installed.
 *
 * Anything beyond structural metadata - decoding, poster extraction, real
 * transcoding - stays behind the VideoTranscoder integration.
 */

export type VideoContainerFormat = 'mp4' | 'webm';

export interface VideoTrackSummary {
  readonly kind: 'video' | 'audio';
  readonly codec?: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly frameCount?: number;
  readonly rotationDegrees?: number;
  readonly projection?: 'equirectangular' | 'cubemap' | 'unknown';
  readonly stereoMode?: 'mono' | 'top-bottom' | 'left-right';
}

export interface VideoContainerSummary {
  readonly container: VideoContainerFormat;
  readonly brands: readonly string[];
  readonly durationMs?: number;
  readonly tracks: readonly VideoTrackSummary[];
  readonly declaredBitrate?: number;
}

const MP4_SIGNATURE = Buffer.from('ftyp', 'ascii');
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export function detectVideoContainer(bytes: Buffer): VideoContainerFormat | undefined {
  if (bytes.length >= 12 && bytes.subarray(4, 8).equals(MP4_SIGNATURE)) {
    return 'mp4';
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(EBML_SIGNATURE)) {
    return 'webm';
  }
  return undefined;
}

export function readVideoContainer(bytes: Buffer): VideoContainerSummary | undefined {
  const container = detectVideoContainer(bytes);
  if (container === 'mp4') return readIsoBaseMediaFile(bytes);
  if (container === 'webm') return readMatroskaFile(bytes);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* ISO base media (MP4 / MOV / 3GP)                                     */
/* ------------------------------------------------------------------ */

interface Mp4Box {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

function readBoxes(bytes: Buffer, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const declaredSize = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    let headerSize = 8;
    let size = declaredSize;
    if (declaredSize === 1) {
      if (offset + 16 > end) break;
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (declaredSize === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function findBox(bytes: Buffer, boxes: readonly Mp4Box[], type: string): Mp4Box | undefined {
  return boxes.find((box) => box.type === type);
}

function childBoxes(bytes: Buffer, box: Mp4Box | undefined): Mp4Box[] {
  return box === undefined ? [] : readBoxes(bytes, box.start, box.end);
}

function readIsoBaseMediaFile(bytes: Buffer): VideoContainerSummary | undefined {
  const top = readBoxes(bytes, 0, bytes.length);
  const ftyp = findBox(bytes, top, 'ftyp');
  const moov = findBox(bytes, top, 'moov');
  if (moov === undefined) return undefined;

  const brands: string[] = [];
  if (ftyp !== undefined && ftyp.end - ftyp.start >= 8) {
    brands.push(bytes.toString('latin1', ftyp.start, ftyp.start + 4).trim());
    for (let offset = ftyp.start + 8; offset + 4 <= ftyp.end; offset += 4) {
      brands.push(bytes.toString('latin1', offset, offset + 4).trim());
    }
  }

  const moovChildren = readBoxes(bytes, moov.start, moov.end);
  const mvhd = findBox(bytes, moovChildren, 'mvhd');
  let durationMs: number | undefined;
  if (mvhd !== undefined) {
    const version = bytes.readUInt8(mvhd.start);
    if (version === 1 && mvhd.end - mvhd.start >= 28) {
      const timescale = bytes.readUInt32BE(mvhd.start + 20);
      const duration = bytes.readBigUInt64BE(mvhd.start + 24);
      durationMs = scaleDuration(Number(duration), timescale);
    } else if (mvhd.end - mvhd.start >= 20) {
      const timescale = bytes.readUInt32BE(mvhd.start + 12);
      const duration = bytes.readUInt32BE(mvhd.start + 16);
      durationMs = scaleDuration(duration, timescale);
    }
  }

  const tracks = moovChildren
    .filter((box) => box.type === 'trak')
    .flatMap((trak) => readTrack(bytes, trak));

  return {
    container: 'mp4',
    brands: brands.filter((brand) => brand.length > 0),
    ...(durationMs === undefined ? {} : { durationMs }),
    tracks,
  };
}

function readTrack(bytes: Buffer, trak: Mp4Box): VideoTrackSummary[] {
  const trakChildren = readBoxes(bytes, trak.start, trak.end);
  const mdia = findBox(bytes, trakChildren, 'mdia');
  const mdiaChildren = childBoxes(bytes, mdia);
  const hdlr = findBox(bytes, mdiaChildren, 'hdlr');
  if (hdlr === undefined || hdlr.end - hdlr.start < 12) return [];
  const handler = bytes.toString('latin1', hdlr.start + 8, hdlr.start + 12);
  const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : undefined;
  if (kind === undefined) return [];

  const mdhd = findBox(bytes, mdiaChildren, 'mdhd');
  let durationMs: number | undefined;
  if (mdhd !== undefined) {
    const version = bytes.readUInt8(mdhd.start);
    if (version === 1 && mdhd.end - mdhd.start >= 28) {
      durationMs = scaleDuration(
        Number(bytes.readBigUInt64BE(mdhd.start + 24)),
        bytes.readUInt32BE(mdhd.start + 20),
      );
    } else if (mdhd.end - mdhd.start >= 20) {
      durationMs = scaleDuration(
        bytes.readUInt32BE(mdhd.start + 16),
        bytes.readUInt32BE(mdhd.start + 12),
      );
    }
  }

  const stbl = findBox(bytes, childBoxes(bytes, findBox(bytes, mdiaChildren, 'minf')), 'stbl');
  const stblChildren = childBoxes(bytes, stbl);
  const stsd = findBox(bytes, stblChildren, 'stsd');
  const sampleEntry = stsd === undefined
    ? undefined
    : readBoxes(bytes, stsd.start + 8, stsd.end)[0];
  const codec = sampleEntry?.type;

  if (kind === 'audio') {
    return [{
      kind,
      ...(codec === undefined ? {} : { codec }),
      ...(durationMs === undefined ? {} : { durationMs }),
    }];
  }

  const tkhd = findBox(bytes, trakChildren, 'tkhd');
  const rotationDegrees = tkhd === undefined ? 0 : readTrackRotation(bytes, tkhd);
  const dimensions = sampleEntry === undefined || sampleEntry.end - sampleEntry.start < 32
    ? undefined
    : {
      width: bytes.readUInt16BE(sampleEntry.start + 24),
      height: bytes.readUInt16BE(sampleEntry.start + 26),
    };
  const frameCount = readFrameCount(bytes, findBox(bytes, stblChildren, 'stts'));
  const spherical = readSphericalMarkers(bytes, sampleEntry, trak);

  return [{
    kind,
    ...(codec === undefined ? {} : { codec }),
    ...(dimensions === undefined ? {} : dimensions),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(frameCount === undefined ? {} : { frameCount }),
    rotationDegrees,
    ...spherical,
  }];
}

function readTrackRotation(bytes: Buffer, tkhd: Mp4Box): number {
  const version = bytes.readUInt8(tkhd.start);
  // version/flags + timestamps + track id + reserved + duration, then the
  // reserved/layer/alternate-group/volume/reserved block before the matrix.
  const matrixOffset = tkhd.start + (version === 1 ? 36 : 24) + 8 + 2 + 2 + 2 + 2;
  if (matrixOffset + 36 > tkhd.end) return 0;
  // 16.16 fixed point matrix; only a/b are needed for the 90 degree cases.
  const a = bytes.readInt32BE(matrixOffset) / 65_536;
  const b = bytes.readInt32BE(matrixOffset + 4) / 65_536;
  const degrees = Math.round(Math.atan2(b, a) * 180 / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

function readFrameCount(bytes: Buffer, stts: Mp4Box | undefined): number | undefined {
  if (stts === undefined || stts.end - stts.start < 8) return undefined;
  const entryCount = bytes.readUInt32BE(stts.start + 4);
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const offset = stts.start + 8 + index * 8;
    if (offset + 8 > stts.end) return undefined;
    total += bytes.readUInt32BE(offset);
  }
  return total > 0 ? total : undefined;
}

/** Reads Spherical Video V2 (st3d/sv3d) and the V1 XML uuid box. */
function readSphericalMarkers(
  bytes: Buffer,
  sampleEntry: Mp4Box | undefined,
  trak: Mp4Box,
): Pick<VideoTrackSummary, 'projection' | 'stereoMode'> {
  const result: {
    projection?: VideoTrackSummary['projection'] | undefined;
    stereoMode?: VideoTrackSummary['stereoMode'] | undefined;
  } = {};
  if (sampleEntry !== undefined) {
    // Sample entry boxes begin with a fixed 78-byte visual header.
    const extensions = readBoxes(bytes, sampleEntry.start + 78, sampleEntry.end);
    const st3d = findBox(bytes, extensions, 'st3d');
    if (st3d !== undefined && st3d.end - st3d.start >= 5) {
      const mode = bytes.readUInt8(st3d.start + 4);
      result.stereoMode = mode === 1 ? 'top-bottom' : mode === 2 ? 'left-right' : 'mono';
    }
    const sv3d = findBox(bytes, extensions, 'sv3d');
    const proj = findBox(bytes, childBoxes(bytes, sv3d), 'proj');
    const projChildren = childBoxes(bytes, proj);
    if (findBox(bytes, projChildren, 'equi') !== undefined) result.projection = 'equirectangular';
    else if (findBox(bytes, projChildren, 'cbmp') !== undefined) result.projection = 'cubemap';
  }
  if (result.projection === undefined) {
    const xml = bytes.toString('latin1', trak.start, trak.end);
    if (xml.includes('GSpherical:Spherical') && /GSpherical:Spherical>\s*true/i.test(xml)) {
      result.projection = /GSpherical:ProjectionType>\s*equirectangular/i.test(xml)
        || !xml.includes('GSpherical:ProjectionType')
        ? 'equirectangular'
        : 'unknown';
    }
  }
  return {
    ...(result.projection === undefined ? {} : { projection: result.projection }),
    ...(result.stereoMode === undefined ? {} : { stereoMode: result.stereoMode }),
  };
}

function scaleDuration(duration: number, timescale: number): number | undefined {
  if (!Number.isFinite(duration) || !Number.isFinite(timescale) || timescale <= 0) return undefined;
  if (duration <= 0) return undefined;
  return Math.round(duration / timescale * 1000);
}

/* ------------------------------------------------------------------ */
/* Matroska / WebM                                                      */
/* ------------------------------------------------------------------ */

const EBML_IDS = {
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  video: 0xe0,
  audio: 0xe1,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  projection: 0x7670,
  projectionType: 0x7671,
  stereoMode: 0x53b8,
} as const;

interface EbmlElement {
  readonly id: number;
  readonly start: number;
  readonly end: number;
}

function readVariableInteger(
  bytes: Buffer,
  offset: number,
  keepMarker: boolean,
): { value: number; length: number } | undefined {
  if (offset >= bytes.length) return undefined;
  const first = bytes.readUInt8(offset);
  if (first === 0) return undefined;
  let length = 1;
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length += 1;
  if (length > 8 || offset + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes.readUInt8(offset + index);
  }
  return Number.isSafeInteger(value) ? { value, length } : undefined;
}

function readEbmlChildren(bytes: Buffer, start: number, end: number): EbmlElement[] {
  const elements: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    const id = readVariableInteger(bytes, offset, true);
    if (id === undefined) break;
    const size = readVariableInteger(bytes, offset + id.length, false);
    if (size === undefined) break;
    const contentStart = offset + id.length + size.length;
    const contentEnd = Math.min(end, contentStart + size.value);
    if (contentStart > end) break;
    elements.push({ id: id.value, start: contentStart, end: contentEnd });
    offset = contentEnd;
    if (contentEnd <= contentStart && size.value !== 0) break;
  }
  return elements;
}

function findEbml(elements: readonly EbmlElement[], id: number): EbmlElement | undefined {
  return elements.find((element) => element.id === id);
}

function readEbmlUnsigned(bytes: Buffer, element: EbmlElement | undefined): number | undefined {
  if (element === undefined || element.end <= element.start) return undefined;
  let value = 0;
  for (let offset = element.start; offset < element.end; offset += 1) {
    value = value * 256 + bytes.readUInt8(offset);
  }
  return Number.isSafeInteger(value) ? value : undefined;
}

function readEbmlFloat(bytes: Buffer, element: EbmlElement | undefined): number | undefined {
  if (element === undefined) return undefined;
  const length = element.end - element.start;
  if (length === 4) return bytes.readFloatBE(element.start);
  if (length === 8) return bytes.readDoubleBE(element.start);
  return undefined;
}

function readEbmlString(bytes: Buffer, element: EbmlElement | undefined): string | undefined {
  if (element === undefined || element.end <= element.start) return undefined;
  return bytes.toString('utf8', element.start, element.end).replace(/\0+$/u, '');
}

function readMatroskaFile(bytes: Buffer): VideoContainerSummary | undefined {
  const top = readEbmlChildren(bytes, 0, bytes.length);
  const segment = findEbml(top, EBML_IDS.segment);
  if (segment === undefined) return undefined;
  const segmentChildren = readEbmlChildren(bytes, segment.start, segment.end);

  const info = findEbml(segmentChildren, EBML_IDS.info);
  const infoChildren = info === undefined ? [] : readEbmlChildren(bytes, info.start, info.end);
  const timecodeScale = readEbmlUnsigned(bytes, findEbml(infoChildren, EBML_IDS.timecodeScale))
    ?? 1_000_000;
  const rawDuration = readEbmlFloat(bytes, findEbml(infoChildren, EBML_IDS.duration));
  const durationMs = rawDuration === undefined
    ? undefined
    : Math.round(rawDuration * timecodeScale / 1_000_000);

  const tracksElement = findEbml(segmentChildren, EBML_IDS.tracks);
  const trackEntries = tracksElement === undefined
    ? []
    : readEbmlChildren(bytes, tracksElement.start, tracksElement.end)
      .filter((element) => element.id === EBML_IDS.trackEntry);

  const tracks = trackEntries.flatMap((entry): VideoTrackSummary[] => {
    const children = readEbmlChildren(bytes, entry.start, entry.end);
    const trackType = readEbmlUnsigned(bytes, findEbml(children, EBML_IDS.trackType));
    const codec = readEbmlString(bytes, findEbml(children, EBML_IDS.codecId));
    if (trackType === 2) {
      return [{ kind: 'audio', ...(codec === undefined ? {} : { codec }) }];
    }
    if (trackType !== 1) return [];
    const video = findEbml(children, EBML_IDS.video);
    const videoChildren = video === undefined ? [] : readEbmlChildren(bytes, video.start, video.end);
    const width = readEbmlUnsigned(bytes, findEbml(videoChildren, EBML_IDS.pixelWidth));
    const height = readEbmlUnsigned(bytes, findEbml(videoChildren, EBML_IDS.pixelHeight));
    const projectionElement = findEbml(videoChildren, EBML_IDS.projection);
    const projectionType = projectionElement === undefined
      ? undefined
      : readEbmlUnsigned(
        bytes,
        findEbml(
          readEbmlChildren(bytes, projectionElement.start, projectionElement.end),
          EBML_IDS.projectionType,
        ),
      );
    const stereoMode = readEbmlUnsigned(bytes, findEbml(videoChildren, EBML_IDS.stereoMode));
    return [{
      kind: 'video',
      ...(codec === undefined ? {} : { codec }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(durationMs === undefined ? {} : { durationMs }),
      rotationDegrees: 0,
      ...(projectionType === 1
        ? { projection: 'equirectangular' as const }
        : projectionType === 2
          ? { projection: 'cubemap' as const }
          : {}),
      ...(stereoMode === undefined
        ? {}
        : {
          stereoMode: stereoMode === 1
            ? 'left-right' as const
            : stereoMode === 3
              ? 'top-bottom' as const
              : 'mono' as const,
        }),
    }];
  });

  return {
    container: 'webm',
    brands: ['webm'],
    ...(durationMs === undefined ? {} : { durationMs }),
    tracks,
  };
}
