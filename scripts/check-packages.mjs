import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  ALLOWED_PEER_DEPENDENCIES,
  ALLOWED_RUNTIME_DEPENDENCIES,
  PACKAGE_REGISTRY,
  PACKAGE_SCOPE,
  PUBLISHED_PACKAGES,
  lockstepVersion,
  packageDirectory,
  readManifest,
  repositoryRoot
} from './shared-packages.mjs';
import { packageVersionSource } from './sync-package-versions.mjs';

/**
 * Everything about the shared package set that must be true before a release.
 *
 * These are the invariants a reviewer cannot hold in their head across six
 * manifests: that the versions move together, that a sibling is pinned rather
 * than ranged, that no seventh dependency arrived, that the published entry
 * points exist, and that nothing in a tarball points at a path or a source file
 * the tarball does not contain.
 */

const CHANGELOG = path.join(repositoryRoot, 'packages', 'CHANGELOG.md');

const problems = [];

function fail(message) {
  problems.push(message);
}

function expectDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}\n    expected ${JSON.stringify(expected)}\n    found    ${JSON.stringify(actual)}`);
  }
}

function allFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

function declarationFiles(directory) {
  return allFiles(directory).filter((file) => file.endsWith('.d.ts') || file.endsWith('.d.mts'));
}

function checkDirectoryMembership() {
  const onDisk = readdirSync(path.join(repositoryRoot, 'packages'))
    .filter((entry) => statSync(path.join(repositoryRoot, 'packages', entry)).isDirectory())
    .sort();
  const declared = [...PUBLISHED_PACKAGES].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(declared)) {
    fail(
      'packages/ and the published set disagree. A package that exists but is not released '
      + 'leaves the frontend importing something no registry has.\n'
      + `    on disk  ${onDisk.join(', ')}\n`
      + `    released ${declared.join(', ')}`
    );
  }
}

function checkManifest(name, version) {
  const manifest = readManifest(name);
  const label = `${PACKAGE_SCOPE}/${name}`;

  if (manifest.name !== `${PACKAGE_SCOPE}/${name}`) {
    fail(`${label}: name is "${manifest.name}"; it must match its directory and the scope.`);
  }
  if (manifest.private === true) {
    fail(`${label}: marked private, so \`npm publish\` would refuse it.`);
  }
  if (manifest.version !== version) {
    fail(`${label}: version ${manifest.version} breaks lockstep with ${version}.`);
  }
  if (manifest.sideEffects !== false) {
    fail(`${label}: sideEffects must be false so a frontend bundler can tree-shake it.`);
  }
  if (typeof manifest.license !== 'string' || manifest.license.length === 0) {
    fail(`${label}: no license field.`);
  }
  if (manifest.type !== 'commonjs') {
    fail(`${label}: type must be "commonjs"; the exports map supplies the ES module build.`);
  }
  if (manifest.engines?.node === undefined) {
    fail(`${label}: no engines.node, so a consumer cannot tell what runtime it supports.`);
  }

  expectDeepEqual(manifest.publishConfig, { registry: PACKAGE_REGISTRY, access: 'restricted' },
    `${label}: publishConfig must pin the private registry.`);

  expectDeepEqual(manifest.repository, {
    type: 'git',
    url: 'git+https://github.com/AliShaikh110/photo-sphere-backend.git',
    directory: `packages/${name}`
  }, `${label}: repository must name this package's directory.`);

  expectDeepEqual(manifest.files, ['dist', 'README.md'], `${label}: files must ship dist and the README only.`);

  expectDeepEqual(manifest.exports, {
    '.': {
      import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
      require: { types: './dist/index.d.ts', default: './dist/index.cjs' }
    },
    './package.json': './package.json'
  }, `${label}: exports map must expose one entry point in both module systems.`);

  if (manifest.main !== './dist/index.cjs') fail(`${label}: main must be ./dist/index.cjs.`);
  if (manifest.module !== './dist/index.mjs') fail(`${label}: module must be ./dist/index.mjs.`);
  if (manifest.types !== './dist/index.d.ts') fail(`${label}: types must be ./dist/index.d.ts.`);

  return manifest;
}

function checkDependencies(name, manifest, version) {
  const label = `${PACKAGE_SCOPE}/${name}`;
  const allowedThirdParty = ALLOWED_RUNTIME_DEPENDENCIES[name] ?? [];
  const allowedPeers = ALLOWED_PEER_DEPENDENCIES[name] ?? [];

  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (dependency.startsWith(`${PACKAGE_SCOPE}/`)) {
      const sibling = dependency.slice(PACKAGE_SCOPE.length + 1);
      if (!PUBLISHED_PACKAGES.includes(sibling)) {
        fail(`${label}: depends on ${dependency}, which is not in the published set.`);
      }
      if (range !== version) {
        fail(
          `${label}: depends on ${dependency}@${range}. Siblings are pinned to the exact `
          + `lockstep version (${version}) so the set can never be mixed.`
        );
      }
      continue;
    }
    if (!allowedThirdParty.includes(dependency)) {
      fail(
        `${label}: runtime dependency "${dependency}" is not on the allowlist. `
        + 'The shared set carries only what it cannot avoid; add it to '
        + 'ALLOWED_RUNTIME_DEPENDENCIES in scripts/shared-packages.mjs, with a reason, '
        + 'or do not depend on it.'
      );
    }
    if (/^(file|link|portal):/u.test(range) || range.startsWith('workspace:')) {
      fail(`${label}: dependency ${dependency}@${range} points at a local path.`);
    }
  }

  for (const dependency of allowedThirdParty) {
    if (manifest.dependencies?.[dependency] === undefined) {
      fail(`${label}: allowlisted dependency "${dependency}" is no longer declared. Prune the allowlist.`);
    }
  }

  const declaredPeers = Object.keys(manifest.peerDependencies ?? {}).sort();
  expectDeepEqual(declaredPeers, [...allowedPeers].sort(),
    `${label}: peer dependencies must match the allowlist exactly.`);
}

function checkGeneratedVersionConstant(name, manifest) {
  const label = `${PACKAGE_SCOPE}/${name}`;
  const source = path.join(packageDirectory(name), 'src', 'package-version.ts');
  if (!existsSync(source)) {
    fail(`${label}: no src/package-version.ts. Run \`npm run packages:sync-versions\`.`);
    return;
  }
  const expected = packageVersionSource(name, manifest.name, manifest.version);
  if (readFileSync(source, 'utf8') !== expected) {
    fail(
      `${label}: the runtime version constant has drifted from package.json. `
      + 'Run `npm run packages:sync-versions`.'
    );
  }
}

function checkReadme(name) {
  if (!existsSync(path.join(packageDirectory(name), 'README.md'))) {
    fail(`${PACKAGE_SCOPE}/${name}: no README.md, so the registry page would be blank.`);
  }
}

function checkBuiltArtifacts(name) {
  const label = `${PACKAGE_SCOPE}/${name}`;
  const dist = path.join(packageDirectory(name), 'dist');
  if (!existsSync(dist)) {
    fail(`${label}: dist/ is missing. Run \`npm run build\` before checking the packages.`);
    return;
  }
  const entryArtifacts = ['index.cjs', 'index.mjs', 'index.d.ts', 'index.d.mts'];
  for (const artifact of entryArtifacts) {
    if (!existsSync(path.join(dist, artifact))) fail(`${label}: dist/${artifact} is missing.`);
  }

  // dist/ is shipped whole, so anything that lands in it is published. Build
  // metadata in particular carries absolute paths from the build machine.
  for (const file of allFiles(dist)) {
    const relative = path.relative(dist, file).split(path.sep).join('/');
    const publishable = entryArtifacts.includes(relative) || relative.endsWith('.d.ts');
    if (!publishable) {
      fail(`${label}: dist/${relative} is not a publishable artifact but would ship in the tarball.`);
    }
  }
  for (const file of [
    path.join(dist, 'index.cjs'),
    path.join(dist, 'index.mjs'),
    ...declarationFiles(dist)
  ]) {
    const relative = path.relative(repositoryRoot, file);
    const contents = readFileSync(file, 'utf8');
    if (contents.includes('sourceMappingURL')) {
      fail(`${relative}: references a source map the tarball does not ship.`);
    }
    if (/(^|[^a-zA-Z0-9])([A-Za-z]:[\\/]|\/(home|Users|root)\/)/u.test(contents)) {
      fail(`${relative}: leaks an absolute path from the build machine.`);
    }
  }
}

function checkChangelog(version) {
  if (!existsSync(CHANGELOG)) {
    fail('packages/CHANGELOG.md is missing. A release without one is a release nobody can review.');
    return;
  }
  const contents = readFileSync(CHANGELOG, 'utf8');
  const heading = new RegExp(`^##\\s+${version.replace(/\./gu, '\\.')}(\\s|$)`, 'mu');
  if (!heading.test(contents)) {
    fail(
      `packages/CHANGELOG.md has no "## ${version}" entry. Every release names its changes, `
      + 'and a change to a property\'s live-patch class must be named explicitly.'
    );
  }
}

function main() {
  checkDirectoryMembership();

  let version;
  try {
    version = lockstepVersion();
  } catch (error) {
    fail(error.message);
    version = null;
  }

  if (version !== null) {
    for (const name of PUBLISHED_PACKAGES) {
      const manifest = checkManifest(name, version);
      checkDependencies(name, manifest, version);
      checkGeneratedVersionConstant(name, manifest);
      checkReadme(name);
      checkBuiltArtifacts(name);
    }
    checkChangelog(version);
  }

  if (problems.length > 0) {
    process.stderr.write(`The shared package set is not releasable:\n\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write('\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `shared package set ${version} is releasable: `
    + `${PUBLISHED_PACKAGES.length} packages, lockstep, allowlisted dependencies only\n`
  );
}

main();
