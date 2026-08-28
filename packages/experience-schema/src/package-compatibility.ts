/**
 * The compatibility contract between a deployed backend and the shared
 * packages a frontend is built against.
 *
 * The failure this exists to prevent is quiet. A property's live-patch
 * classification moves from `live` to `recompile`, a frontend on the older
 * table keeps mutating the running viewer, and the creator is shown a preview
 * that no longer matches what publishes. Nothing throws, nothing logs, and the
 * divergence is only found by a customer.
 *
 * So the backend states the floor, the frontend checks it before it renders
 * anything, and a mismatch is a startup failure naming the version to install.
 */

/** Every package in the lockstep set, by published name. */
export const SHARED_PACKAGE_NAMES = Object.freeze([
  '@alishaikh110/telemetry-contract',
  '@alishaikh110/capability-registry',
  '@alishaikh110/experience-schema',
  '@alishaikh110/viewer-integration',
  '@alishaikh110/experience-compiler',
  '@alishaikh110/live-patch'
] as const);

export type SharedPackageName = (typeof SHARED_PACKAGE_NAMES)[number];

/**
 * What `/editor-bootstrap` reports under `packageCompatibility`.
 *
 * `minimumCompatibleVersion` is the floor a frontend must meet.
 * `backendPackageVersions` is what the deployed backend is itself running, and
 * is what the remedy tells a developer to install.
 */
export interface SharedPackageContract {
  readonly registry: string;
  readonly scope: string;
  readonly minimumCompatibleVersion: string;
  readonly backendPackageVersions: Readonly<Record<string, string>>;
}

/** The versions a consumer reports, read from each package's own constant. */
export type InstalledSharedPackages = Readonly<Record<string, string>>;

export type PackageCompatibilityStatus =
  | 'compatible'
  /** Not installed, or not reported by the consumer. */
  | 'missing'
  /** Present but not a version this can compare. */
  | 'unreadable'
  /** Older than the floor the backend published. */
  | 'below-minimum'
  /** A newer major than the backend runs: its compiler is not this backend's. */
  | 'ahead-of-backend';

export interface PackageCompatibilityEntry {
  readonly packageName: string;
  readonly installedVersion: string | null;
  readonly backendVersion: string;
  readonly status: PackageCompatibilityStatus;
}

export interface PackageCompatibilityReport {
  readonly compatible: boolean;
  readonly minimumCompatibleVersion: string;
  readonly entries: readonly PackageCompatibilityEntry[];
  /** One line per distinct problem, in the order a reader should act on them. */
  readonly problems: readonly string[];
  /** The install command that resolves every problem, or `null` when there are none. */
  readonly remedy: string | null;
  /** The whole failure as one message, or `null` when compatible. */
  readonly message: string | null;
}

interface ParsedVersion {
  readonly release: readonly number[];
  readonly prerelease: readonly (string | number)[];
}

const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * Parses a semantic version.
 *
 * Written here rather than taken from a dependency: the set publishes with no
 * third-party runtime code beyond the two it cannot avoid, and adding one to
 * compare three integers would be a poor trade.
 */
export function parsePackageVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (match === null) return null;
  const release = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? '', 10));
  if (release.some((part) => !Number.isSafeInteger(part))) return null;
  const prerelease = (match[4] ?? '')
    .split('.')
    .filter((identifier) => identifier.length > 0)
    .map((identifier) => (/^\d+$/u.test(identifier) ? Number.parseInt(identifier, 10) : identifier));
  return { release, prerelease };
}

function comparePrerelease(
  left: readonly (string | number)[],
  right: readonly (string | number)[]
): number {
  // A release outranks any prerelease of the same numbers.
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = typeof a === 'number';
    const bNumeric = typeof b === 'number';
    if (aNumeric && bNumeric) return a < b ? -1 : 1;
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return String(a) < String(b) ? -1 : 1;
  }
  return 0;
}

/** `-1`, `0` or `1`. Throws on a version neither side can read. */
export function comparePackageVersions(left: string, right: string): -1 | 0 | 1 {
  const a = parsePackageVersion(left);
  const b = parsePackageVersion(right);
  if (a === null) throw new Error(`Not a semantic version: ${left}`);
  if (b === null) throw new Error(`Not a semantic version: ${right}`);
  for (let index = 0; index < 3; index += 1) {
    const first = a.release[index] ?? 0;
    const second = b.release[index] ?? 0;
    if (first !== second) return first < second ? -1 : 1;
  }
  const prerelease = comparePrerelease(a.prerelease, b.prerelease);
  return prerelease === 0 ? 0 : prerelease < 0 ? -1 : 1;
}

function installCommand(contract: SharedPackageContract): string {
  const specifiers = SHARED_PACKAGE_NAMES.map((name) => {
    const version = contract.backendPackageVersions[name];
    return version === undefined ? name : `${name}@${version}`;
  });
  return `npm install ${specifiers.join(' ')}`;
}

/**
 * Compares what a consumer has installed against what the backend requires.
 *
 * Never throws for a bad input: a report is more useful than a stack trace at
 * the point this runs, which is application startup.
 */
export function checkSharedPackageCompatibility(
  contract: SharedPackageContract,
  installed: InstalledSharedPackages
): PackageCompatibilityReport {
  const entries: PackageCompatibilityEntry[] = [];
  const problems: string[] = [];
  const readable: string[] = [];

  for (const packageName of SHARED_PACKAGE_NAMES) {
    const backendVersion = contract.backendPackageVersions[packageName] ?? '';
    const raw = installed[packageName];
    if (raw === undefined || raw.length === 0) {
      entries.push({ packageName, installedVersion: null, backendVersion, status: 'missing' });
      problems.push(`${packageName} is not installed.`);
      continue;
    }
    if (parsePackageVersion(raw) === null) {
      entries.push({ packageName, installedVersion: raw, backendVersion, status: 'unreadable' });
      problems.push(`${packageName} reports "${raw}", which is not a semantic version.`);
      continue;
    }
    readable.push(raw);

    if (comparePackageVersions(raw, contract.minimumCompatibleVersion) < 0) {
      entries.push({ packageName, installedVersion: raw, backendVersion, status: 'below-minimum' });
      problems.push(
        `${packageName} is ${raw}; this backend requires at least `
        + `${contract.minimumCompatibleVersion}.`
      );
      continue;
    }

    const backend = parsePackageVersion(backendVersion);
    const installedParsed = parsePackageVersion(raw);
    if (
      backend !== null
      && installedParsed !== null
      && (installedParsed.release[0] ?? 0) > (backend.release[0] ?? 0)
    ) {
      entries.push({
        packageName,
        installedVersion: raw,
        backendVersion,
        status: 'ahead-of-backend'
      });
      problems.push(
        `${packageName} is ${raw}, a newer major than the ${backendVersion} this backend `
        + 'compiles with. Its compiler and this one would not agree.'
      );
      continue;
    }

    entries.push({ packageName, installedVersion: raw, backendVersion, status: 'compatible' });
  }

  // Lockstep is the whole point of releasing the set together. A consumer
  // holding two versions at once is running a combination nobody has tested.
  const distinct = [...new Set(readable)].sort();
  if (distinct.length > 1) {
    problems.push(
      `The installed packages are not in lockstep: ${distinct.join(', ')}. `
      + 'The set is released together and must be installed together.'
    );
  }

  const compatible = problems.length === 0;
  const remedy = compatible ? null : installCommand(contract);
  const message = compatible
    ? null
    : [
      'The installed @alishaikh110 packages are not compatible with this backend.',
      ...problems.map((problem) => `  - ${problem}`),
      '',
      `Install the versions this backend runs:\n  ${remedy ?? ''}`
    ].join('\n');

  return {
    compatible,
    minimumCompatibleVersion: contract.minimumCompatibleVersion,
    entries,
    problems,
    remedy,
    message
  };
}

/** Thrown at startup by a consumer running an incompatible package set. */
export class SharedPackageCompatibilityError extends Error {
  readonly report: PackageCompatibilityReport;

  constructor(report: PackageCompatibilityReport) {
    super(report.message ?? 'Incompatible shared packages.');
    this.name = 'SharedPackageCompatibilityError';
    this.report = report;
  }
}

/**
 * The frontend's startup gate.
 *
 * Call it once, before anything renders, with the version constant each shared
 * package exports. A failure here is loud and names the fix; the alternative is
 * a preview that silently disagrees with what publishes.
 */
export function assertSharedPackageCompatibility(
  contract: SharedPackageContract,
  installed: InstalledSharedPackages
): PackageCompatibilityReport {
  const report = checkSharedPackageCompatibility(contract, installed);
  if (!report.compatible) throw new SharedPackageCompatibilityError(report);
  return report;
}
