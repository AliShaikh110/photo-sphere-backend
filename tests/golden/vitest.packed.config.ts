import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The behaviour freeze, run against the packages a second repository installs.
 *
 * `vitest.config.ts` aliases the shared packages to their TypeScript sources,
 * which is right for developing them and useless for this question. A published
 * artifact can differ from its source in ways only the build introduces: an
 * exports map that resolves to the wrong file, a bundler that dropped a
 * side-effectful module, a dependency that was externalised and never
 * installed. So this config points the same fifteen fixtures at the installed
 * tarballs instead, and any difference is a difference in what a customer's
 * published experience looks like.
 *
 * `scripts/verify-packages.mjs` sets the directory; run `npm run
 * packages:verify` rather than this config directly.
 */

const packedDirectory = process.env.SPHERE_PACKED_PACKAGES_DIR;

if (packedDirectory === undefined || packedDirectory.length === 0) {
  throw new Error(
    'SPHERE_PACKED_PACKAGES_DIR is not set. This config runs the golden fixtures '
    + 'against installed packages rather than sources; run `npm run packages:verify`, '
    + 'which packs, installs and points this at the result.'
  );
}

function packedPackage(name: string): string {
  return path.join(packedDirectory as string, name);
}

export default defineConfig({
  resolve: {
    alias: {
      '@alishaikh110/capability-registry': packedPackage('capability-registry'),
      '@alishaikh110/experience-compiler': packedPackage('experience-compiler'),
      '@alishaikh110/experience-schema': packedPackage('experience-schema'),
      '@alishaikh110/live-patch': packedPackage('live-patch'),
      '@alishaikh110/telemetry-contract': packedPackage('telemetry-contract'),
      '@alishaikh110/viewer-integration': packedPackage('viewer-integration')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    root: path.resolve(__dirname, '..', '..'),
    include: ['tests/unit/golden/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false
  }
});
