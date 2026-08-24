import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

const testRoot = mkdtempSync(path.join(tmpdir(), 'sphere-backend-test-'));
const storageRoot = path.join(testRoot, 'storage');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-longer-than-thirty-two-characters';
process.env.JWT_EXPIRES_IN = '15m';
process.env.PUBLIC_BASE_URL = 'http://sphere.test';
process.env.CORS_ORIGINS = 'http://client.sphere.test';
process.env.STORAGE_ROOT = storageRoot;
process.env.MAX_IMAGE_UPLOAD_BYTES = String(1024 * 1024);
process.env.MAX_IMAGE_PIXELS = String(10_000_000);
process.env.UPLOAD_SESSION_TTL_SECONDS = '300';
process.env.SIGNED_MEDIA_TTL_SECONDS = '60';
process.env.MEDIA_WORKER_MODE = 'disabled';
process.env.LOG_LEVEL = 'silent';
process.env.AUTO_MIGRATE = 'false';
process.env.SPHERE_TEST_ROOT = testRoot;

afterAll(() => {
  const resolvedRoot = path.resolve(testRoot);
  const temporaryDirectory = `${path.resolve(tmpdir())}${path.sep}`;
  if (!resolvedRoot.startsWith(temporaryDirectory) || path.basename(resolvedRoot).length < 20) {
    throw new Error(`Refusing to remove unsafe test path: ${resolvedRoot}`);
  }
  rmSync(resolvedRoot, { recursive: true, force: true });
});
