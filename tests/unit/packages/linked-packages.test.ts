import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findLinkedPackages } from '../../../scripts/assert-no-linked-packages.mjs';

/**
 * The guard that stops a locally linked package reaching a production build.
 *
 * Linking is the documented way to iterate on the compiler while building the
 * editor. The risk is that it leaves nothing behind to notice: a developer
 * links during a sprint, forgets, and a build ships against a working copy that
 * only exists on their machine.
 *
 * There are three ways a link happens and they leave three different traces, so
 * each is exercised here. A guard that catches one of them is worse than none,
 * because it is trusted.
 */

const SCOPE = '@alishaikh110';
const created: string[] = [];

function scratchProject(manifest: Record<string, unknown>, lock?: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'linked-guard-'));
  created.push(root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (lock !== undefined) {
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock, null, 2), 'utf8');
  }
  return root;
}

function installPackage(root: string, name: string): string {
  const directory = path.join(root, 'node_modules', SCOPE, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: `${SCOPE}/${name}`, version: '1.0.0' }),
    'utf8'
  );
  return directory;
}

const released = {
  name: 'frontend',
  dependencies: {
    [`${SCOPE}/experience-compiler`]: '1.0.0',
    [`${SCOPE}/live-patch`]: '1.0.0'
  }
};

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the linked-package guard', () => {
  it('passes a project installed from the registry', () => {
    const root = scratchProject(released);
    installPackage(root, 'experience-compiler');
    installPackage(root, 'live-patch');
    expect(findLinkedPackages(root, SCOPE)).toEqual([]);
  });

  it('catches a local specifier written into package.json', () => {
    const root = scratchProject({
      ...released,
      dependencies: {
        ...released.dependencies,
        [`${SCOPE}/experience-compiler`]: 'file:../sphere-backend/packages/experience-compiler'
      }
    });
    const problems = findLinkedPackages(root, SCOPE);
    expect(problems.map((problem) => problem.kind)).toEqual(['local-specifier']);
    expect(problems[0]?.detail).toContain('experience-compiler');
  });

  it('catches a local override, which no dependency listing would show', () => {
    const root = scratchProject({
      ...released,
      overrides: { [`${SCOPE}/live-patch`]: 'link:../sphere-backend/packages/live-patch' }
    });
    expect(findLinkedPackages(root, SCOPE).map((problem) => problem.kind))
      .toEqual(['local-specifier']);
  });

  it('catches a link recorded in the lockfile, which is what a CI build installs', () => {
    const root = scratchProject(released, {
      name: 'frontend',
      lockfileVersion: 3,
      packages: {
        '': { name: 'frontend' },
        [`node_modules/${SCOPE}/experience-compiler`]: {
          resolved: '../sphere-backend/packages/experience-compiler',
          link: true
        },
        [`node_modules/${SCOPE}/live-patch`]: {
          version: '1.0.0',
          resolved: 'https://npm.pkg.github.com/@alishaikh110/live-patch/-/live-patch-1.0.0.tgz'
        }
      }
    });
    const problems = findLinkedPackages(root, SCOPE);
    expect(problems.map((problem) => problem.kind)).toEqual(['linked-in-lockfile']);
    expect(problems[0]?.detail).toContain('experience-compiler');
  });

  it('catches a tarball installed from disk rather than the registry', () => {
    const root = scratchProject(released, {
      name: 'frontend',
      lockfileVersion: 3,
      packages: {
        [`node_modules/${SCOPE}/experience-compiler`]: {
          version: '1.0.0',
          resolved: 'file:../tarballs/alishaikh110-experience-compiler-1.0.0.tgz'
        }
      }
    });
    expect(findLinkedPackages(root, SCOPE).map((problem) => problem.kind))
      .toEqual(['local-in-lockfile']);
  });

  it('catches `npm link`, which leaves no trace in package.json or the lockfile', () => {
    const root = scratchProject(released);
    installPackage(root, 'live-patch');

    const target = mkdtempSync(path.join(os.tmpdir(), 'linked-guard-source-'));
    created.push(target);
    writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ name: `${SCOPE}/experience-compiler`, version: '1.1.0-dev' }),
      'utf8'
    );
    // `junction` is the directory link Windows creates without elevation, and
    // is what npm uses there; Node reports it as a symbolic link either way.
    symlinkSync(
      target,
      path.join(root, 'node_modules', SCOPE, 'experience-compiler'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const problems = findLinkedPackages(root, SCOPE);
    expect(problems.map((problem) => problem.kind)).toEqual(['symlinked-install']);
    expect(problems[0]?.detail).toContain('experience-compiler');
  });

  it('reports a project with no manifest rather than passing it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'linked-guard-empty-'));
    created.push(root);
    expect(findLinkedPackages(root, SCOPE).map((problem) => problem.kind)).toEqual(['no-manifest']);
  });

  it('ignores local paths outside the scope, which are not its business', () => {
    const root = scratchProject({
      ...released,
      dependencies: { ...released.dependencies, 'some-other-package': 'file:../elsewhere' }
    });
    expect(findLinkedPackages(root, SCOPE)).toEqual([]);
  });
});
