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

/**
 * An equirectangular panorama whose XMP records a tilted capture pose and the
 * framing the photographer chose. It exercises the metadata that reaches a
 * scene's default view and its straighten correction.
 */
export async function posedEquirectangularJpeg(): Promise<Buffer> {
  const xmp = `
    <x:xmpmeta xmlns:x="adobe:ns:meta/">
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"
          GPano:ProjectionType="equirectangular"
          GPano:UsePanoramaViewer="True"
          GPano:PoseHeadingDegrees="30"
          GPano:PosePitchDegrees="-4.5"
          GPano:PoseRollDegrees="2"
          GPano:InitialViewHeadingDegrees="210"
          GPano:InitialViewPitchDegrees="12"
          GPano:InitialHorizontalFOVDegrees="65" />
      </rdf:RDF>
    </x:xmpmeta>`;
  return sharp({
    create: {
      width: 256,
      height: 128,
      channels: 3,
      background: { r: 28, g: 92, b: 156 }
    }
  })
    .jpeg({ quality: 82 })
    .withXmp(xmp)
    .toBuffer();
}
