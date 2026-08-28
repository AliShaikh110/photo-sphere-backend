import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findLinkedPackages } from './assert-no-linked-packages.mjs';
import { packPackages } from './pack-packages.mjs';
import {
  ALLOWED_PEER_DEPENDENCIES,
  ALLOWED_RUNTIME_DEPENDENCIES,
  PACKAGE_SCOPE,
  PUBLISHED_PACKAGES,
  repositoryRoot
} from './shared-packages.mjs';

/**
 * Installs the packed packages into a project outside this repository and
 * proves the gate on the installed artifacts.
 *
 * Inspecting `dist/` proves nothing: the workspace resolves these packages by
 * symlink and by tsconfig path, so every mistake a second repository would hit
 * is invisible here. This installs the tarballs the registry would serve, into
 * a project that has never heard of the workspace, and checks what a frontend
 * actually gets:
 *
 *   - both module systems load, and the exports map resolves under Node's own
 *     rules as well as a bundler's
 *   - `compile()` is fully typed at the call site, not `any`
 *   - the dependency tree holds nothing outside the allowlist, and no Node
 *     built-in reaches the browser build
 *   - every package reports its own version
 *   - the compatibility check refuses an older set with an actionable message
 *   - the published compiler reproduces the Sprint 05 golden fixtures byte for
 *     byte
 */

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const isWindows = process.platform === 'win32';

const failures = [];
const passed = [];

function check(description, run) {
  try {
    run();
    passed.push(description);
    process.stdout.write(`  ok    ${description}\n`);
  } catch (error) {
    failures.push({ description, error });
    process.stdout.write(`  FAIL  ${description}\n`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    shell: isWindows && command.endsWith('.cmd'),
    ...options
  });
}

function allFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

// ---------------------------------------------------------------- scaffolding

function createConsumerProject(root, tarballs) {
  const project = path.join(root, 'project');
  mkdirSync(path.join(project, 'src'), { recursive: true });

  const dependencies = {};
  const overrides = {};
  for (const [name, tarball] of tarballs) {
    const specifier = `file:${path.relative(project, tarball).split(path.sep).join('/')}`;
    dependencies[name] = specifier;
    // Without an override a sibling would be fetched from the registry, and the
    // verification would silently test a previous release instead of this one.
    overrides[name] = specifier;
  }

  writeFileSync(
    path.join(project, 'package.json'),
    `${JSON.stringify({
      name: 'shared-package-consumer',
      version: '0.0.0',
      private: true,
      type: 'commonjs',
      dependencies,
      overrides
    }, null, 2)}\n`,
    'utf8'
  );
  return project;
}

const CONSUMER_IMPORTS = `
import { CAPABILITY_REGISTRY, CAPABILITY_REGISTRY_PACKAGE_VERSION } from '@alishaikh110/capability-registry';
import { runtimeEventNameSchema, TELEMETRY_CONTRACT_PACKAGE_VERSION } from '@alishaikh110/telemetry-contract';
import {
  assertSharedPackageCompatibility,
  CANONICAL_SCHEMA_VERSION,
  EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  SHARED_PACKAGE_NAMES,
  type SharedPackageContract
} from '@alishaikh110/experience-schema';
import {
  createViewerIntegrationAdapter,
  VIEWER_INTEGRATION_PACKAGE_VERSION
} from '@alishaikh110/viewer-integration';
import {
  compile,
  ExperienceCompilationError,
  EXPERIENCE_COMPILER_PACKAGE_VERSION,
  type CompilerInput,
  type CompileResult
} from '@alishaikh110/experience-compiler';
import {
  LIVE_PATCH_CLASSIFICATIONS,
  LIVE_PATCH_CONTRACT_VERSION,
  LIVE_PATCH_PACKAGE_VERSION
} from '@alishaikh110/live-patch';

/**
 * \`any\` would satisfy every assertion below, so the shape of the types is
 * checked as well as their presence: a package that shipped without
 * declarations, or resolved to \`any\`, fails here rather than at a call site
 * months later.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

declare const input: CompilerInput;

const result: CompileResult = compile(input);
const contentHash: string = result.contentHash;
const compilerIsTyped: IsAny<typeof result> = false;
const hashIsTyped: IsAny<typeof contentHash> = false;

const classification: 'live' | 'recompile' | 'remount' = LIVE_PATCH_CLASSIFICATIONS[0]!.class;
const schemaVersion: 1 = CANONICAL_SCHEMA_VERSION;
const contractVersion: string = LIVE_PATCH_CONTRACT_VERSION;
const adapterIsTyped: IsAny<ReturnType<typeof createViewerIntegrationAdapter>> = false;
const registryIsTyped: IsAny<typeof CAPABILITY_REGISTRY> = false;
const eventSchemaIsTyped: IsAny<typeof runtimeEventNameSchema> = false;
const names: readonly string[] = SHARED_PACKAGE_NAMES;

declare const contract: SharedPackageContract;
const report = assertSharedPackageCompatibility(contract, {
  '@alishaikh110/telemetry-contract': TELEMETRY_CONTRACT_PACKAGE_VERSION,
  '@alishaikh110/capability-registry': CAPABILITY_REGISTRY_PACKAGE_VERSION,
  '@alishaikh110/experience-schema': EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  '@alishaikh110/viewer-integration': VIEWER_INTEGRATION_PACKAGE_VERSION,
  '@alishaikh110/experience-compiler': EXPERIENCE_COMPILER_PACKAGE_VERSION,
  '@alishaikh110/live-patch': LIVE_PATCH_PACKAGE_VERSION
});
const compatible: boolean = report.compatible;

// @ts-expect-error compile() rejects an input that is not a CompilerInput.
compile({ definitely: 'not a compiler input' });

// @ts-expect-error a compilation error carries typed issues, not an arbitrary shape.
const issues: number = new ExperienceCompilationError([]).issues;

export const surface = {
  contentHash, compilerIsTyped, hashIsTyped, classification, schemaVersion,
  contractVersion, adapterIsTyped, registryIsTyped, eventSchemaIsTyped, names,
  compatible, issues
};
`;

function writeTypeCheckFixtures(project) {
  writeFileSync(path.join(project, 'src', 'consumer.ts'), CONSUMER_IMPORTS, 'utf8');
  writeFileSync(path.join(project, 'src', 'consumer.mts'), CONSUMER_IMPORTS, 'utf8');
  writeFileSync(path.join(project, 'src', 'consumer.cts'), CONSUMER_IMPORTS, 'utf8');

  const base = {
    strict: true,
    noEmit: true,
    // What a real consumer does. Turning it off would type-check zod's and
    // sanitize-html's declarations rather than ours.
    skipLibCheck: true,
    esModuleInterop: true,
    target: 'ES2022',
    lib: ['ES2022', 'DOM']
  };

  // How Next.js resolves.
  writeFileSync(
    path.join(project, 'tsconfig.bundler.json'),
    `${JSON.stringify({
      compilerOptions: { ...base, module: 'ESNext', moduleResolution: 'bundler' },
      files: ['src/consumer.ts']
    }, null, 2)}\n`,
    'utf8'
  );

  // How Node resolves: the strictest reader of a dual package's exports map.
  // `.mts` takes the import condition, `.cts` the require condition.
  writeFileSync(
    path.join(project, 'tsconfig.nodenext.json'),
    `${JSON.stringify({
      compilerOptions: { ...base, module: 'NodeNext', moduleResolution: 'NodeNext' },
      files: ['src/consumer.mts', 'src/consumer.cts']
    }, null, 2)}\n`,
    'utf8'
  );
}

const RUNTIME_ASSERTIONS = `
const expected = EXPECTED_VERSION;
const problems = [];

function expect(condition, message) { if (!condition) problems.push(message); }

expect(typeof compile === 'function', 'compile() is not a function');
expect(typeof contentHash === 'function', 'contentHash() is not a function');
expect(Array.isArray(LIVE_PATCH_CLASSIFICATIONS) && LIVE_PATCH_CLASSIFICATIONS.length > 0,
  'the live-patch classification table is empty');
expect(CAPABILITY_REGISTRY !== null && typeof CAPABILITY_REGISTRY === 'object'
  && Object.keys(CAPABILITY_REGISTRY).length > 0, 'the capability registry is empty');
expect(typeof createViewerIntegrationAdapter === 'function',
  'createViewerIntegrationAdapter() is not a function');
expect(typeof runtimeEventNameSchema?.parse === 'function',
  'the telemetry event schema did not resolve against the peer zod');
expect(CANONICAL_SCHEMA_VERSION === 1, 'CANONICAL_SCHEMA_VERSION is not 1');

// A viewer integration adapter has to be constructible from the installed
// package, not merely exported by it.
const adapter = createViewerIntegrationAdapter('psv-5.14.3-adapter-2');
expect(adapter !== undefined && adapter !== null, 'the viewer integration adapter did not construct');

for (const [name, version] of Object.entries(versions)) {
  expect(version === expected, name + ' reports ' + version + ', expected ' + expected);
}

// The startup gate: a frontend a major behind must be refused, by name.
let refused = null;
try {
  assertSharedPackageCompatibility(
    {
      registry: 'https://npm.pkg.github.com',
      scope: '@alishaikh110',
      minimumCompatibleVersion: '2.0.0',
      backendPackageVersions: Object.fromEntries(
        SHARED_PACKAGE_NAMES.map((name) => [name, '2.3.1'])
      )
    },
    versions
  );
} catch (error) {
  refused = error;
}
expect(refused !== null, 'a package set below the minimum was accepted');
expect(refused !== null && refused.name === 'SharedPackageCompatibilityError',
  'the refusal was not a SharedPackageCompatibilityError');
expect(refused !== null && /requires at least 2\\.0\\.0/.test(refused.message),
  'the refusal did not name the minimum version: ' + (refused && refused.message));
expect(refused !== null && refused.message.includes('npm install @alishaikh110/'),
  'the refusal did not name an install command: ' + (refused && refused.message));
expect(refused !== null && refused.message.includes('@alishaikh110/experience-compiler@2.3.1'),
  'the refusal did not name the version to install: ' + (refused && refused.message));

// The same set at the backend's own version must be accepted.
const accepted = assertSharedPackageCompatibility(
  {
    registry: 'https://npm.pkg.github.com',
    scope: '@alishaikh110',
    minimumCompatibleVersion: expected,
    backendPackageVersions: Object.fromEntries(SHARED_PACKAGE_NAMES.map((name) => [name, expected]))
  },
  versions
);
expect(accepted.compatible === true, 'a matching package set was refused');

if (problems.length > 0) {
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log('ok');
`;

const EXPORT_PARITY = `
import { createRequire } from 'node:module';

/**
 * The CommonJS and ES module builds must expose the same names.
 *
 * A bundler forwards \`export * from\` an external package differently
 * depending on whether it sits on the entry module or a nested one, and the
 * difference is silent: the CommonJS build copies the names across at runtime
 * while the ES module build simply does not have them. Nothing fails until a
 * consumer imports a name that only one of the two builds carries.
 */
const require = createRequire(import.meta.url);
const names = PACKAGE_NAMES;
const problems = [];

const ignored = new Set(['default', '__esModule']);
const keys = (module) => Object.keys(module).filter((key) => !ignored.has(key)).sort();

for (const name of names) {
  const cjs = keys(require(name));
  const esm = keys(await import(name));
  const missingFromEsm = cjs.filter((key) => !esm.includes(key));
  const missingFromCjs = esm.filter((key) => !cjs.includes(key));
  if (cjs.length === 0) problems.push(name + ' exports nothing from its CommonJS build');
  if (esm.length === 0) problems.push(name + ' exports nothing from its ES module build');
  if (missingFromEsm.length > 0) {
    problems.push(name + ': the ES module build is missing ' + missingFromEsm.join(', '));
  }
  if (missingFromCjs.length > 0) {
    problems.push(name + ': the CommonJS build is missing ' + missingFromCjs.join(', '));
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log('ok');
`;

function writeParityFixture(project) {
  writeFileSync(
    path.join(project, 'parity.mjs'),
    EXPORT_PARITY.replace(
      'PACKAGE_NAMES',
      JSON.stringify(PUBLISHED_PACKAGES.map((name) => `${PACKAGE_SCOPE}/${name}`))
    ),
    'utf8'
  );
}

function writeRuntimeFixtures(project, version) {
  const names = {
    capabilityRegistry: '@alishaikh110/capability-registry',
    telemetryContract: '@alishaikh110/telemetry-contract',
    experienceSchema: '@alishaikh110/experience-schema',
    viewerIntegration: '@alishaikh110/viewer-integration',
    experienceCompiler: '@alishaikh110/experience-compiler',
    livePatch: '@alishaikh110/live-patch'
  };

  const versionsLiteral = `const versions = {
  '${names.telemetryContract}': TELEMETRY_CONTRACT_PACKAGE_VERSION,
  '${names.capabilityRegistry}': CAPABILITY_REGISTRY_PACKAGE_VERSION,
  '${names.experienceSchema}': EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  '${names.viewerIntegration}': VIEWER_INTEGRATION_PACKAGE_VERSION,
  '${names.experienceCompiler}': EXPERIENCE_COMPILER_PACKAGE_VERSION,
  '${names.livePatch}': LIVE_PATCH_PACKAGE_VERSION
};`;

  const body = RUNTIME_ASSERTIONS.replace('EXPECTED_VERSION', JSON.stringify(version));

  writeFileSync(
    path.join(project, 'runtime.cjs'),
    [
      '// CommonJS consumer: exercises the `require` condition of the exports map.',
      `const { CAPABILITY_REGISTRY, CAPABILITY_REGISTRY_PACKAGE_VERSION } = require('${names.capabilityRegistry}');`,
      `const { runtimeEventNameSchema, TELEMETRY_CONTRACT_PACKAGE_VERSION } = require('${names.telemetryContract}');`,
      `const { assertSharedPackageCompatibility, CANONICAL_SCHEMA_VERSION, SHARED_PACKAGE_NAMES, EXPERIENCE_SCHEMA_PACKAGE_VERSION } = require('${names.experienceSchema}');`,
      `const { createViewerIntegrationAdapter, VIEWER_INTEGRATION_PACKAGE_VERSION } = require('${names.viewerIntegration}');`,
      `const { compile, contentHash, EXPERIENCE_COMPILER_PACKAGE_VERSION } = require('${names.experienceCompiler}');`,
      `const { LIVE_PATCH_CLASSIFICATIONS, LIVE_PATCH_PACKAGE_VERSION } = require('${names.livePatch}');`,
      '',
      versionsLiteral,
      body
    ].join('\n'),
    'utf8'
  );

  writeFileSync(
    path.join(project, 'runtime.mjs'),
    [
      '// ES module consumer: exercises the `import` condition of the exports map.',
      `import { CAPABILITY_REGISTRY, CAPABILITY_REGISTRY_PACKAGE_VERSION } from '${names.capabilityRegistry}';`,
      `import { runtimeEventNameSchema, TELEMETRY_CONTRACT_PACKAGE_VERSION } from '${names.telemetryContract}';`,
      `import { assertSharedPackageCompatibility, CANONICAL_SCHEMA_VERSION, SHARED_PACKAGE_NAMES, EXPERIENCE_SCHEMA_PACKAGE_VERSION } from '${names.experienceSchema}';`,
      `import { createViewerIntegrationAdapter, VIEWER_INTEGRATION_PACKAGE_VERSION } from '${names.viewerIntegration}';`,
      `import { compile, contentHash, EXPERIENCE_COMPILER_PACKAGE_VERSION } from '${names.experienceCompiler}';`,
      `import { LIVE_PATCH_CLASSIFICATIONS, LIVE_PATCH_PACKAGE_VERSION } from '${names.livePatch}';`,
      '',
      versionsLiteral,
      body
    ].join('\n'),
    'utf8'
  );
}

// ------------------------------------------------------------------ the gate

function verifyInstalledDependencies(project) {
  for (const name of PUBLISHED_PACKAGES) {
    const installed = path.join(project, 'node_modules', PACKAGE_SCOPE, name);
    assert(existsSync(installed), `${PACKAGE_SCOPE}/${name} did not install`);
    const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
    const allowed = new Set([
      ...(ALLOWED_RUNTIME_DEPENDENCIES[name] ?? []),
      ...PUBLISHED_PACKAGES.map((sibling) => `${PACKAGE_SCOPE}/${sibling}`)
    ]);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      assert(
        allowed.has(dependency),
        `${PACKAGE_SCOPE}/${name} installed with an unexpected runtime dependency: ${dependency}`
      );
    }
    const peers = Object.keys(manifest.peerDependencies ?? {}).sort();
    const expectedPeers = [...(ALLOWED_PEER_DEPENDENCIES[name] ?? [])].sort();
    assert(
      JSON.stringify(peers) === JSON.stringify(expectedPeers),
      `${PACKAGE_SCOPE}/${name} installed with peers ${JSON.stringify(peers)}, expected ${JSON.stringify(expectedPeers)}`
    );
  }
}

function verifyInstalledArtifacts(project) {
  const builtins = /require\(\s*["'](?:node:)?(fs|path|os|crypto|http|https|net|child_process|worker_threads|stream|buffer|url|util|zlib|dns|tls|vm|module)["']\s*\)/u;
  for (const name of PUBLISHED_PACKAGES) {
    const installed = path.join(project, 'node_modules', PACKAGE_SCOPE, name);
    for (const file of allFiles(path.join(installed, 'dist'))) {
      const relative = `${PACKAGE_SCOPE}/${name}/dist/${path.relative(path.join(installed, 'dist'), file).split(path.sep).join('/')}`;
      const contents = readFileSync(file, 'utf8');
      assert(!contents.includes('sourceMappingURL'), `${relative} references a source map`);
      assert(
        !/(^|[^a-zA-Z0-9])([A-Za-z]:[\\/]|\/(home|Users|root)\/)/u.test(contents),
        `${relative} leaks an absolute path from the build machine`
      );
      assert(!builtins.test(contents), `${relative} requires a Node built-in and cannot run in a browser`);
    }
  }
}

function verifyPeerInstalled(project) {
  assert(
    existsSync(path.join(project, 'node_modules', 'zod')),
    'zod was not installed for the consumer; the peer dependency on telemetry-contract is not doing its job'
  );
  assert(
    existsSync(path.join(project, 'node_modules', 'sanitize-html')),
    'sanitize-html was not installed for the consumer'
  );
}

/**
 * The linking guard, exercised against a real `npm install` tree.
 *
 * This project installs from tarballs on disk, which is exactly the shape a
 * frontend has while a developer iterates on the compiler locally. So the guard
 * must flag it. A guard that is only ever run against synthetic fixtures is a
 * guard nobody has seen fire on the platform CI actually runs on.
 */
function verifyLinkedPackageGuard(project, version) {
  const problems = findLinkedPackages(project, PACKAGE_SCOPE);
  assert(
    problems.length > 0,
    'the linked-package guard passed a project installed entirely from local tarballs, '
    + 'so it would not stop a linked package reaching a frontend build'
  );
  const kinds = new Set(problems.map((problem) => problem.kind));
  assert(
    kinds.has('local-specifier') || kinds.has('local-in-lockfile'),
    `the guard fired but not on the local install: ${[...kinds].join(', ')}`
  );

  // And it must pass the same tree once the local specifiers are gone.
  const releasedLikeProject = path.join(path.dirname(project), 'released-like');
  mkdirSync(releasedLikeProject, { recursive: true });
  writeFileSync(
    path.join(releasedLikeProject, 'package.json'),
    `${JSON.stringify({
      name: 'released-like-consumer',
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries(
        PUBLISHED_PACKAGES.map((name) => [`${PACKAGE_SCOPE}/${name}`, version])
      )
    }, null, 2)}
`,
    'utf8'
  );
  const clean = findLinkedPackages(releasedLikeProject, PACKAGE_SCOPE);
  assert(
    clean.length === 0,
    `the guard flagged a project with only registry versions: ${clean.map((p) => p.detail).join('; ')}`
  );
}

function verifyGoldenFixtures(project) {
  run(npm, ['run', '--silent', 'test:golden:packed'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      SPHERE_PACKED_PACKAGES_DIR: path.join(project, 'node_modules', PACKAGE_SCOPE)
    }
  });
}

// ----------------------------------------------------------------- entrypoint

function main() {
  const keep = process.argv.includes('--keep');
  const root = mkdtempSync(path.join(os.tmpdir(), 'sphere-packages-'));
  process.stdout.write(`verifying the published package set in ${root}\n\n`);

  let project = null;
  try {
    const { version, tarballs } = packPackages(path.join(root, 'tarballs'));
    process.stdout.write(`packed ${tarballs.size} packages at ${version}\n\n`);

    project = createConsumerProject(root, tarballs);
    writeTypeCheckFixtures(project);
    writeRuntimeFixtures(project, version);
    writeParityFixture(project);

    process.stdout.write('installing into a project outside the workspace\n');
    run(npm, ['install', '--no-audit', '--no-fund', '--loglevel', 'error'], {
      cwd: project,
      stdio: 'inherit'
    });
    process.stdout.write('\n');

    check('every package installs from its tarball with allowlisted dependencies only',
      () => verifyInstalledDependencies(project));
    check('the declared peers reach the consumer',
      () => verifyPeerInstalled(project));
    check('no installed artifact ships a source map, a build path or a Node built-in',
      () => verifyInstalledArtifacts(project));
    check('a CommonJS consumer loads every package and reports its version',
      () => run(process.execPath, ['runtime.cjs'], { cwd: project }));
    check('an ES module consumer loads every package and reports its version',
      () => run(process.execPath, ['runtime.mjs'], { cwd: project }));
    check('the CommonJS and ES module builds expose the same names',
      () => run(process.execPath, ['parity.mjs'], { cwd: project }));
    check('types resolve under a bundler, and compile() is not any', () => {
      run(process.execPath, [
        path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p', 'tsconfig.bundler.json'
      ], { cwd: project });
    });
    check('types resolve under Node\'s own resolution, in both module systems', () => {
      run(process.execPath, [
        path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p', 'tsconfig.nodenext.json'
      ], { cwd: project });
    });
    check('the linked-package guard fires on a local install and passes a released one',
      () => verifyLinkedPackageGuard(project, version));
    check('the published compiler reproduces the golden fixtures byte for byte',
      () => verifyGoldenFixtures(project));
  } finally {
    if (keep) {
      process.stdout.write(`\nkept the verification project at ${root}\n`);
    } else if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }

  process.stdout.write('\n');
  if (failures.length > 0) {
    process.stderr.write(`${failures.length} of ${passed.length + failures.length} checks failed:\n\n`);
    for (const { description, error } of failures) {
      process.stderr.write(`  ${description}\n`);
      const detail = error.stdout ?? error.stderr ?? error.message;
      process.stderr.write(`${String(detail).split('\n').map((line) => `      ${line}`).join('\n')}\n\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`the published package set passes all ${passed.length} checks\n`);
}

main();
