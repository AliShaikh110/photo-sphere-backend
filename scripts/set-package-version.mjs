import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  PACKAGE_SCOPE,
  PUBLISHED_PACKAGES,
  manifestPath,
  readManifest,
  repositoryRoot
} from './shared-packages.mjs';

/**
 * Moves the whole shared package set to one version.
 *
 * Lockstep is not a convention here, it is the mechanism. The compiler and the
 * live-patch classification table must never be mismatched, and independent
 * versions would produce combinations nobody has tested. So there is no way to
 * bump one package: this rewrites all six, repoints every sibling pin, and
 * regenerates the runtime constants in the same pass.
 */

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u;

function usage(message) {
  process.stderr.write(
    `${message}\n\n`
    + 'Usage: npm run packages:version -- <version>\n'
    + '   or: npm run packages:version -- major|minor|patch\n\n'
    + 'A change to compiled output, a change to any property\'s live-patch class,\n'
    + 'a schemaVersion increment or a retired viewer integration is a major.\n'
  );
  process.exitCode = 1;
}

function nextVersion(current, level) {
  const match = VERSION_PATTERN.exec(current);
  if (match === null) throw new Error(`Current version is not a semantic version: ${current}`);
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function main() {
  const requested = process.argv[2];
  if (requested === undefined) {
    usage('No version given.');
    return;
  }

  const current = readManifest(PUBLISHED_PACKAGES[0]).version;
  const version = ['major', 'minor', 'patch'].includes(requested)
    ? nextVersion(current, requested)
    : requested;

  if (!VERSION_PATTERN.test(version)) {
    usage(`"${version}" is not a semantic version.`);
    return;
  }

  for (const name of PUBLISHED_PACKAGES) {
    const file = manifestPath(name);
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    manifest.version = version;
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      // Siblings are pinned exactly, so the set cannot be mixed by a resolver.
      if (dependency.startsWith(`${PACKAGE_SCOPE}/`)) manifest.dependencies[dependency] = version;
    }
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${manifest.name} ${current} -> ${version}\n`);
  }

  execFileSync(process.execPath, [path.join(repositoryRoot, 'scripts', 'sync-package-versions.mjs')], {
    cwd: repositoryRoot,
    stdio: 'inherit'
  });

  process.stdout.write(
    `\nNext:\n`
    + `  1. Add a "## ${version}" entry to packages/CHANGELOG.md, naming any\n`
    + `     live-patch classification change explicitly.\n`
    + `  2. npm run build && npm run packages:check\n`
    + `  3. Commit, then tag: git tag packages-v${version} && git push --tags\n`
    + `     The tag is what releases; publishing never runs from a developer machine.\n`
  );
}

main();
