import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Shared packages resolve to their TypeScript sources so the suite exercises
 * the code under review rather than a previously built artifact.
 */
const workspaceAliases = {
  '@sphere/api': path.resolve(__dirname, 'apps/api/src/index.ts'),
  '@sphere/capability-registry': path.resolve(__dirname, 'packages/capability-registry/src/index.ts'),
  '@sphere/experience-compiler': path.resolve(__dirname, 'packages/experience-compiler/src/index.ts'),
  '@sphere/experience-schema': path.resolve(__dirname, 'packages/experience-schema/src/index.ts'),
  '@sphere/live-patch': path.resolve(__dirname, 'packages/live-patch/src/index.ts'),
  '@sphere/telemetry-contract': path.resolve(__dirname, 'packages/telemetry-contract/src/index.ts'),
  '@sphere/viewer-integration': path.resolve(__dirname, 'packages/viewer-integration/src/index.ts')
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    hookTimeout: 20_000,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
      exclude: [
        'apps/api/src/server.ts',
        'apps/worker/src/worker.ts',
        'apps/api/src/database/migrate.ts'
      ]
    }
  }
});
