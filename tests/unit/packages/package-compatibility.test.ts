import { describe, expect, it } from 'vitest';

import {
  SHARED_PACKAGE_NAMES,
  SharedPackageCompatibilityError,
  assertSharedPackageCompatibility,
  checkSharedPackageCompatibility,
  comparePackageVersions,
  parsePackageVersion,
  type InstalledSharedPackages,
  type SharedPackageContract
} from '@alishaikh110/experience-schema';

/**
 * The backstop for the failure Sprint 05 found with autorotation.
 *
 * A property moves from `live` to `recompile`, the frontend keeps the older
 * classification table, and its live mutations stop matching what the compiler
 * does. Nothing throws. The creator is shown a preview that disagrees with what
 * publishes, and only a customer finds out.
 *
 * The version policy is what prevents it; this is what catches it when the
 * policy is not followed.
 */

function contract(overrides: Partial<SharedPackageContract> = {}): SharedPackageContract {
  const version = overrides.minimumCompatibleVersion ?? '2.0.0';
  return {
    registry: 'https://npm.pkg.github.com',
    scope: '@alishaikh110',
    minimumCompatibleVersion: version,
    backendPackageVersions: Object.fromEntries(
      SHARED_PACKAGE_NAMES.map((name) => [name, version])
    ),
    ...overrides
  };
}

function installed(version: string, overrides: Record<string, string> = {}): InstalledSharedPackages {
  return {
    ...Object.fromEntries(SHARED_PACKAGE_NAMES.map((name) => [name, version])),
    ...overrides
  };
}

describe('semantic version comparison', () => {
  it('orders releases by each field in turn', () => {
    expect(comparePackageVersions('1.0.0', '1.0.0')).toBe(0);
    expect(comparePackageVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(comparePackageVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(comparePackageVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('ranks a prerelease below the release it precedes', () => {
    expect(comparePackageVersions('2.0.0-rc.1', '2.0.0')).toBe(-1);
    expect(comparePackageVersions('2.0.0', '2.0.0-rc.1')).toBe(1);
    expect(comparePackageVersions('2.0.0-rc.2', '2.0.0-rc.10')).toBe(-1);
    expect(comparePackageVersions('2.0.0-alpha', '2.0.0-beta')).toBe(-1);
    expect(comparePackageVersions('2.0.0-rc.1', '2.0.0-rc.1.1')).toBe(-1);
  });

  it('ignores build metadata, which carries no precedence', () => {
    expect(comparePackageVersions('1.2.3+build.7', '1.2.3')).toBe(0);
  });

  it('reads a version or reports that it cannot', () => {
    expect(parsePackageVersion('1.2.3')).not.toBeNull();
    for (const bad of ['1.2', 'v1.2.3', '', 'latest', '1.2.3.4', '1.2.x']) {
      expect(parsePackageVersion(bad), bad).toBeNull();
    }
  });
});

describe('shared package compatibility', () => {
  it('accepts a set that matches the backend', () => {
    const report = checkSharedPackageCompatibility(contract(), installed('2.0.0'));
    expect(report.compatible).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.remedy).toBeNull();
    expect(report.message).toBeNull();
    expect(report.entries).toHaveLength(SHARED_PACKAGE_NAMES.length);
    expect(report.entries.every((entry) => entry.status === 'compatible')).toBe(true);
  });

  it('accepts a set newer than the floor within the same major', () => {
    const report = checkSharedPackageCompatibility(
      contract({
        minimumCompatibleVersion: '2.0.0',
        backendPackageVersions: Object.fromEntries(
          SHARED_PACKAGE_NAMES.map((name) => [name, '2.4.0'])
        )
      }),
      installed('2.1.0')
    );
    expect(report.compatible).toBe(true);
  });

  it('refuses a set below the floor and names the version to install', () => {
    const report = checkSharedPackageCompatibility(contract(), installed('1.9.9'));
    expect(report.compatible).toBe(false);
    expect(report.entries.every((entry) => entry.status === 'below-minimum')).toBe(true);
    expect(report.problems).toHaveLength(SHARED_PACKAGE_NAMES.length);
    expect(report.problems[0]).toContain('requires at least 2.0.0');
    // Actionable means a command, not a diagnosis.
    expect(report.remedy).toContain('npm install');
    for (const name of SHARED_PACKAGE_NAMES) {
      expect(report.remedy).toContain(`${name}@2.0.0`);
    }
  });

  it('refuses a major ahead of the backend, which is the same divergence reversed', () => {
    const report = checkSharedPackageCompatibility(contract(), installed('3.0.0'));
    expect(report.compatible).toBe(false);
    expect(report.entries.every((entry) => entry.status === 'ahead-of-backend')).toBe(true);
    expect(report.problems[0]).toContain('newer major');
  });

  it('refuses a set that is not in lockstep, whatever the versions are', () => {
    const report = checkSharedPackageCompatibility(
      contract(),
      installed('2.0.0', { '@alishaikh110/live-patch': '2.1.0' })
    );
    expect(report.compatible).toBe(false);
    // Every package clears the floor; the set is still untested as a combination.
    expect(report.entries.every((entry) => entry.status === 'compatible')).toBe(true);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('not in lockstep');
    expect(report.problems[0]).toContain('2.0.0, 2.1.0');
  });

  it('reports a package that is not installed at all', () => {
    const partial = { ...installed('2.0.0') } as Record<string, string>;
    delete partial['@alishaikh110/live-patch'];
    const report = checkSharedPackageCompatibility(contract(), partial);
    expect(report.compatible).toBe(false);
    expect(report.problems).toContain('@alishaikh110/live-patch is not installed.');
    expect(
      report.entries.find((entry) => entry.packageName === '@alishaikh110/live-patch')?.status
    ).toBe('missing');
  });

  it('reports a version string it cannot read rather than guessing', () => {
    const report = checkSharedPackageCompatibility(
      contract(),
      installed('2.0.0', { '@alishaikh110/experience-compiler': 'workspace' })
    );
    expect(report.compatible).toBe(false);
    expect(report.problems[0]).toContain('not a semantic version');
    expect(
      report.entries.find((entry) => entry.packageName === '@alishaikh110/experience-compiler')?.status
    ).toBe('unreadable');
  });

  it('does not throw on bad input: startup needs a report, not a stack trace', () => {
    expect(() => checkSharedPackageCompatibility(contract(), {})).not.toThrow();
    expect(() => checkSharedPackageCompatibility(contract(), installed('nonsense'))).not.toThrow();
  });
});

describe('the startup gate', () => {
  it('returns the report when the set is compatible', () => {
    const report = assertSharedPackageCompatibility(contract(), installed('2.0.0'));
    expect(report.compatible).toBe(true);
  });

  it('fails loudly, and the message alone is enough to fix it', () => {
    let thrown: unknown = null;
    try {
      assertSharedPackageCompatibility(contract(), installed('1.0.0'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SharedPackageCompatibilityError);
    const error = thrown as SharedPackageCompatibilityError;
    expect(error.name).toBe('SharedPackageCompatibilityError');
    expect(error.report.compatible).toBe(false);

    // What a developer sees: what is wrong, and the command that fixes it.
    expect(error.message).toContain('not compatible with this backend');
    expect(error.message).toContain('@alishaikh110/experience-compiler is 1.0.0');
    expect(error.message).toContain('requires at least 2.0.0');
    expect(error.message).toContain('npm install @alishaikh110/telemetry-contract@2.0.0');
  });

  it('names the classification package, because that is the one that fails silently', () => {
    let message = '';
    try {
      assertSharedPackageCompatibility(contract(), installed('1.0.0'));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('@alishaikh110/live-patch is 1.0.0');
  });
});
