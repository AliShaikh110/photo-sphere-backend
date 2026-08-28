import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = path.resolve(__dirname, '..', '..');

export default defineConfig({
  resolve: {
    alias: {
      '@alishaikh110/api': path.resolve(root, 'apps/api/src/index.ts'),
      '@alishaikh110/capability-registry': path.resolve(root, 'packages/capability-registry/src/index.ts'),
      '@alishaikh110/experience-compiler': path.resolve(root, 'packages/experience-compiler/src/index.ts'),
      '@alishaikh110/experience-schema': path.resolve(root, 'packages/experience-schema/src/index.ts'),
      '@alishaikh110/live-patch': path.resolve(root, 'packages/live-patch/src/index.ts'),
      '@alishaikh110/telemetry-contract': path.resolve(root, 'packages/telemetry-contract/src/index.ts'),
      '@alishaikh110/viewer-integration': path.resolve(root, 'packages/viewer-integration/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
  },
});
