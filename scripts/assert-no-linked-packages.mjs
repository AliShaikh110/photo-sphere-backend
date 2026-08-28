import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Refuses a build whose shared packages come from a local path.
 *
 * Linking is the right way to iterate on the compiler while building the
 * editor: publishing on every edit would make that work miserable. The problem
 * is that a link is invisible afterwards. A developer links during a sprint,
 * forgets, and a production build ships against whatever was on their disk —
 * an unreleased compiler, a half-edited classification table, or nothing at
 * all on the machine that runs CI.
 *
 * So the link is allowed and the build is not. Run this in the consumer's CI
 * before `next build`, and in the release pipeline here.
 *
 *   node scripts/assert-no-linked-packages.mjs [--project <dir>] [--scope @alishaikh110]
 *
 * `docs/shared-packages.md` has the frontend CI step.
 */

const LOCAL_SPECIFIER = /^(file|link|portal):/u;

export function findLinkedPackages(projectRoot, scope) {
  const problems = [];
  const manifestPath = path.join(projectRoot, 'package.json');
  if (!existsSync(manifestPath)) {
    return [{
      kind: 'no-manifest',
      detail: `${projectRoot} has no package.json.`
    }];
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // 1. A local specifier written straight into the manifest.
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides', 'resolutions']) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (typeof specifier !== 'string') continue;
      if (!name.startsWith(`${scope}/`)) continue;
      if (LOCAL_SPECIFIER.test(specifier) || specifier.startsWith('workspace:')) {
        problems.push({
          kind: 'local-specifier',
          detail: `package.json ${field}.${name} is "${specifier}", not a registry version.`
        });
      }
    }
  }

  // 2. A local specifier that reached the lockfile, which is what a build uses.
  const lockPath = path.join(projectRoot, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const [location, entry] of Object.entries(lock.packages ?? {})) {
      if (!location.includes(`node_modules/${scope}/`)) continue;
      if (entry?.link === true) {
        problems.push({
          kind: 'linked-in-lockfile',
          detail: `package-lock.json records ${location} as a link to ${entry.resolved ?? 'a local path'}.`
        });
      }
      if (typeof entry?.resolved === 'string' && LOCAL_SPECIFIER.test(entry.resolved)) {
        problems.push({
          kind: 'local-in-lockfile',
          detail: `package-lock.json resolves ${location} to "${entry.resolved}".`
        });
      }
    }
  }

  // 3. `npm link`, which leaves no trace in either file: a symlink in place of
  //    the installed directory.
  const scopeDirectory = path.join(projectRoot, 'node_modules', scope);
  if (existsSync(scopeDirectory)) {
    for (const entry of readdirSync(scopeDirectory)) {
      const installed = path.join(scopeDirectory, entry);
      const stats = lstatSync(installed);
      if (stats.isSymbolicLink() || stats.isDirectory() === false) {
        const target = (() => {
          try {
            return realpathSync(installed);
          } catch {
            return '(unresolvable)';
          }
        })();
        problems.push({
          kind: 'symlinked-install',
          detail: `node_modules/${scope}/${entry} is a link to ${target}.`
        });
      }
    }
  }

  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  const projectIndex = argv.indexOf('--project');
  const scopeIndex = argv.indexOf('--scope');
  const projectRoot = path.resolve(projectIndex === -1 ? process.cwd() : argv[projectIndex + 1] ?? '.');
  const scope = scopeIndex === -1 ? '@alishaikh110' : argv[scopeIndex + 1] ?? '@alishaikh110';

  const problems = findLinkedPackages(projectRoot, scope);
  if (problems.length > 0) {
    process.stderr.write(
      `${scope} packages are linked to a local path, so this build would not be reproducible:\n\n`
    );
    for (const problem of problems) process.stderr.write(`  - ${problem.detail}\n`);
    process.stderr.write(
      '\nLinking is for local iteration only. Before building, restore the released\n'
      + `versions:\n\n  npm unlink --no-save ${scope}/experience-compiler   # for each linked package\n`
      + '  npm ci\n'
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`no linked ${scope} packages in ${projectRoot}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
