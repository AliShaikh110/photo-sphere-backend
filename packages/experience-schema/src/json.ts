/**
 * JSON helpers with no host dependency.
 *
 * The compiler measures and hashes its own output, and it has to do so
 * identically on a server and in a browser. `Buffer` exists in only one of
 * those, so byte length is computed from the code points directly.
 */

/** The UTF-8 byte length of a string, without allocating a buffer. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // A surrogate pair is one code point encoded in four bytes.
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** The UTF-8 byte length of a value's JSON rendering. */
export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value) ?? '');
}

/**
 * A key-sorted JSON rendering.
 *
 * Two structurally identical values render identically whatever order their
 * keys were built in, which is what makes a content hash comparable between a
 * server compile and a browser compile.
 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(',')}}`;
}
