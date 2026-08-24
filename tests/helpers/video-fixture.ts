/**
 * Builds structurally valid ISO base media (MP4) files for tests.
 *
 * The payload is not decodable video, but the box structure matches the spec
 * closely enough to exercise the platform's container inspection: dimensions,
 * duration, frame rate, codec identity, audio presence, track rotation and the
 * Spherical Video V2 projection markers.
 */

const IDENTITY_MATRIX = [
  0x00010000, 0, 0,
  0, 0x00010000, 0,
  0, 0, 0x40000000,
];

const ROTATION_MATRIX_90 = [
  0, 0x00010000, 0,
  -0x00010000, 0, 0,
  0, 0, 0x40000000,
];

function box(type: string, ...payloads: Buffer[]): Buffer {
  const body = Buffer.concat(payloads);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

function u8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function i32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function zeros(length: number): Buffer {
  return Buffer.alloc(length);
}

function matrix(values: readonly number[]): Buffer {
  return Buffer.concat(values.map((value) => i32(value)));
}

export interface Mp4FixtureOptions {
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly frameRate?: number;
  readonly videoCodec?: string;
  readonly audio?: boolean;
  readonly audioCodec?: string;
  readonly spherical?: boolean;
  readonly stereoMode?: 0 | 1 | 2;
  readonly rotationDegrees?: 0 | 90;
  readonly brands?: readonly string[];
  /** Extra filler bytes so the file has a realistic size for bitrate maths. */
  readonly payloadBytes?: number;
}

export function buildMp4Fixture(options: Mp4FixtureOptions = {}): Buffer {
  const width = options.width ?? 1_024;
  const height = options.height ?? 512;
  const durationMs = options.durationMs ?? 4_000;
  const frameRate = options.frameRate ?? 30;
  const timescale = 1_000;
  const duration = Math.round(durationMs * timescale / 1_000);
  const frameCount = Math.max(1, Math.round(durationMs / 1_000 * frameRate));
  const spherical = options.spherical ?? true;
  const brands = options.brands ?? ['isom', 'iso2', 'avc1', 'mp41'];

  const ftyp = box(
    'ftyp',
    Buffer.from(brands[0]!.padEnd(4, ' ').slice(0, 4), 'latin1'),
    u32(512),
    ...brands.map((brand) => Buffer.from(brand.padEnd(4, ' ').slice(0, 4), 'latin1')),
  );

  const mvhd = box(
    'mvhd',
    u32(0), // version 0 + flags
    u32(0), // creation
    u32(0), // modification
    u32(timescale),
    u32(duration),
    u32(0x00010000), // rate
    u16(0x0100), // volume
    zeros(10),
    matrix(IDENTITY_MATRIX),
    zeros(24),
    u32(3), // next track id
  );

  const videoTrack = buildTrack({
    trackId: 1,
    handler: 'vide',
    timescale,
    duration,
    matrixValues: options.rotationDegrees === 90 ? ROTATION_MATRIX_90 : IDENTITY_MATRIX,
    sampleEntry: buildVisualSampleEntry({
      codec: options.videoCodec ?? 'avc1',
      width,
      height,
      spherical,
      stereoMode: options.stereoMode ?? 0,
    }),
    frameCount,
    sampleDelta: Math.max(1, Math.round(timescale / frameRate)),
    width,
    height,
  });

  const audioTrack = (options.audio ?? true)
    ? buildTrack({
      trackId: 2,
      handler: 'soun',
      timescale,
      duration,
      matrixValues: IDENTITY_MATRIX,
      sampleEntry: buildAudioSampleEntry(options.audioCodec ?? 'mp4a'),
      frameCount,
      sampleDelta: 1_024,
      width: 0,
      height: 0,
    })
    : undefined;

  const moov = box('moov', mvhd, videoTrack, ...(audioTrack === undefined ? [] : [audioTrack]));
  const payload = Buffer.alloc(options.payloadBytes ?? 8_192, 0x11);
  const mdat = box('mdat', payload);
  return Buffer.concat([ftyp, moov, mdat]);
}

function buildTrack(options: {
  trackId: number;
  handler: 'vide' | 'soun';
  timescale: number;
  duration: number;
  matrixValues: readonly number[];
  sampleEntry: Buffer;
  frameCount: number;
  sampleDelta: number;
  width: number;
  height: number;
}): Buffer {
  const tkhd = box(
    'tkhd',
    u32(0x00000007), // version 0, enabled/in-movie/in-preview
    u32(0), // creation
    u32(0), // modification
    u32(options.trackId),
    u32(0), // reserved
    u32(options.duration),
    zeros(8), // reserved
    u16(0), // layer
    u16(0), // alternate group
    u16(options.handler === 'soun' ? 0x0100 : 0), // volume
    u16(0), // reserved
    matrix(options.matrixValues),
    u32(options.width << 16),
    u32(options.height << 16),
  );

  const mdhd = box(
    'mdhd',
    u32(0), // version 0 + flags
    u32(0),
    u32(0),
    u32(options.timescale),
    u32(options.duration),
    u16(0x55c4), // language: und
    u16(0),
  );

  const hdlr = box(
    'hdlr',
    u32(0),
    u32(0),
    Buffer.from(options.handler, 'latin1'),
    zeros(12),
    Buffer.from('Handler\0', 'latin1'),
  );

  const stsd = box('stsd', u32(0), u32(1), options.sampleEntry);
  const stts = box('stts', u32(0), u32(1), u32(options.frameCount), u32(options.sampleDelta));
  const stsc = box('stsc', u32(0), u32(0));
  const stsz = box('stsz', u32(0), u32(0), u32(0));
  const stco = box('stco', u32(0), u32(0));
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const dinf = box('dinf', box('dref', u32(0), u32(1), box('url ', u32(1))));
  const minf = box(
    'minf',
    options.handler === 'vide'
      ? box('vmhd', u32(1), u16(0), zeros(6))
      : box('smhd', u32(0), u16(0), u16(0)),
    dinf,
    stbl,
  );
  const mdia = box('mdia', mdhd, hdlr, minf);
  return box('trak', tkhd, mdia);
}

function buildVisualSampleEntry(options: {
  codec: string;
  width: number;
  height: number;
  spherical: boolean;
  stereoMode: 0 | 1 | 2;
}): Buffer {
  const extensions: Buffer[] = [];
  if (options.spherical) {
    extensions.push(box('st3d', u32(0), u8(options.stereoMode)));
    extensions.push(box(
      'sv3d',
      box('svhd', Buffer.from('sphere-backend-test\0', 'latin1')),
      box(
        'proj',
        box('prhd', u32(0), i32(0), i32(0), i32(0)),
        box('equi', u32(0), u32(0), u32(0), u32(0), u32(0)),
      ),
    ));
  }
  return box(
    options.codec.padEnd(4, ' ').slice(0, 4),
    zeros(6), // reserved
    u16(1), // data reference index
    u16(0), // pre_defined
    u16(0), // reserved
    zeros(12), // pre_defined
    u16(options.width),
    u16(options.height),
    u32(0x00480000), // horizontal resolution 72dpi
    u32(0x00480000), // vertical resolution 72dpi
    u32(0), // reserved
    u16(1), // frame count
    zeros(32), // compressor name
    u16(0x0018), // depth
    Buffer.from([0xff, 0xff]), // pre_defined = -1
    ...extensions,
  );
}

function buildAudioSampleEntry(codec: string): Buffer {
  return box(
    codec.padEnd(4, ' ').slice(0, 4),
    zeros(6),
    u16(1), // data reference index
    zeros(8), // reserved
    u16(2), // channel count
    u16(16), // sample size
    u16(0), // pre_defined
    u16(0), // reserved
    u32(48_000 << 16), // sample rate
  );
}

/** A 4096-wide equirectangular MP4: exactly at the handheld width ceiling. */
export function buildHandheldSafe360Mp4(): Buffer {
  return buildMp4Fixture({ width: 4_096, height: 2_048, durationMs: 6_000, frameRate: 30 });
}

/** An 8192-wide equirectangular MP4 that no handheld profile may publish as-is. */
export function buildOversized360Mp4(): Buffer {
  return buildMp4Fixture({ width: 8_192, height: 4_096, durationMs: 6_000, frameRate: 30 });
}
