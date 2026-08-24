import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorageProvider } from '../../../src/integrations/storage/local-storage';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local object storage keys', () => {
  it('allows safe filenames containing consecutive dots without allowing traversal segments', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sphere-storage-test-'));
    temporaryRoots.push(root);
    const storage = new LocalStorageProvider(root);

    await storage.put('originals/owner/asset/lobby..final.jpg', Buffer.from('safe'));
    expect((await storage.get('originals/owner/asset/lobby..final.jpg')).body.toString()).toBe('safe');
    await expect(storage.put('originals/owner/../escape.jpg', Buffer.from('unsafe')))
      .rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });
  });
});
