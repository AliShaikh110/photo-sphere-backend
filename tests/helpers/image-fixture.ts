import { createHash } from 'node:crypto';

import sharp from 'sharp';

export async function generatedEquirectangularJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 128,
      channels: 3,
      background: { r: 28, g: 92, b: 156 }
    }
  })
    .jpeg({ quality: 82 })
    .toBuffer();
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
