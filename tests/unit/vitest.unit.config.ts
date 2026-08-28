import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = path.resolve(__dirname, '..', '..');

export default defineConfig({
  resolve: {
    alias: {
      '@sphere/api': path.resolve(root, 'apps/api/src/index.ts'),
      '@sphere/capability-registry': path.resolve(root, 'packages/capability-registry/src/index.ts'),
      '@sphere/experience-compiler': path.resolve(root, 'packages/experience-compiler/src/index.ts'),
      '@sphere/experience-schema': path.resolve(root, 'packages/experience-schema/src/index.ts'),
      '@sphere/live-patch': path.resolve(root, 'packages/live-patch/src/index.ts'),
      '@sphere/telemetry-contract': path.resolve(root, 'packages/telemetry-contract/src/index.ts'),
      '@sphere/viewer-integration': path.resolve(root, 'packages/viewer-integration/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
  },
});
