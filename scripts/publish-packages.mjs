import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  PACKAGE_REGISTRY,
  PACKAGE_SCOPE,
  PUBLISHED_PACKAGES,
  lockstepVersion,
  packageDirectory,
  repositoryRoot
} from './shared-packages.mjs';

/**
 * Releases the shared package set.
 *
 * One command, all six packages, one version. The gates are enforced here
 * rather than as workflow steps, because a workflow step can be reordered or
 * removed in a hurry and this cannot: a publish that has not proved the golden
 * fixtures is exactly the publish that quietly changes what every customer's
 * experience looks like.
 *
 * It refuses to run anywhere but CI, on a tag. Publishing from a laptop skips
 * whichever gate that laptop happened not to run.
 */

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const TAG_PREFIX = 'packages-v';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
    ...options
  });
}

function refuse(reason, remedy) {
  process.stderr.write(`\nRefusing to publish: ${reason}\n`);
  if (remedy !== undefined) process.stderr.write(`\n${remedy}\n`);
  process.exitCode = 1;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const version = lockstepVersion();

  process.stdout.write(
    `${dryRun ? 'Dry run' : 'Release'}: ${PACKAGE_SCOPE}/* at ${version} -> ${PACKAGE_REGISTRY}\n\n`
  );

  if (!dryRun) {
    if (process.env.CI !== 'true') {
      refuse(
        'this is not CI.',
        'Publishing runs from the tag workflow so every release passes the same gates.\n'
        + 'To rehearse locally: npm run packages:publish -- --dry-run'
      );
      return;
    }

    const ref = process.env.GITHUB_REF ?? '';
    const expectedRef = `refs/tags/${TAG_PREFIX}${version}`;
    if (ref !== expectedRef) {
      refuse(
        `the workflow ref is "${ref || '(unset)'}", not "${expectedRef}".`,
        `A release is triggered by its tag, and the tag has to name the version the\n`
        + `packages actually carry. Either the tag or packages/*/package.json is wrong.`
      );
      return;
    }

    if (process.env.NODE_AUTH_TOKEN === undefined || process.env.NODE_AUTH_TOKEN === '') {
      refuse('NODE_AUTH_TOKEN is not set, so npm would publish anonymously and fail.');
      return;
    }

    const dirty = run('git', ['status', '--porcelain']).trim();
    if (dirty.length > 0) {
      refuse(
        'the working tree has uncommitted changes.',
        `A published artifact must correspond to a commit:\n${dirty}`
      );
      return;
    }
  }

  // The gates, in the order that fails fastest.
  const gates = [
    ['metadata, lockstep, dependency allowlist and changelog', [npm, ['run', '--silent', 'packages:check']]],
    ['the compiler behaviour freeze', [npm, ['run', '--silent', 'test:golden']]],
    ['the published artifacts, installed into a project outside this repository', [npm, ['run', '--silent', 'packages:verify']]]
  ];

  for (const [description, [command, args]] of gates) {
    process.stdout.write(`gate: ${description}\n`);
    try {
      run(command, args, { stdio: 'inherit' });
    } catch {
      refuse(`the gate "${description}" failed. Nothing was published.`);
      return;
    }
    process.stdout.write('\n');
  }

  for (const name of PUBLISHED_PACKAGES) {
    const label = `${PACKAGE_SCOPE}/${name}@${version}`;
    process.stdout.write(`publishing ${label}\n`);
    try {
      run(npm, ['publish', ...(dryRun ? ['--dry-run'] : [])], {
        cwd: packageDirectory(name),
        stdio: 'inherit'
      });
    } catch {
      refuse(
        `${label} failed to publish.`,
        PUBLISHED_PACKAGES.indexOf(name) === 0
          ? 'Nothing was published.'
          : `Packages before it in the set are already published at ${version}. Do not\n`
            + `retry with the same version: fix the cause, run \`npm run packages:version --\n`
            + `patch\`, and release again. A registry version is immutable.`
      );
      return;
    }
  }

  process.stdout.write(
    `\n${dryRun ? 'Dry run complete' : `Released ${PUBLISHED_PACKAGES.length} packages at ${version}`}.\n`
  );
  if (!dryRun) {
    process.stdout.write(
      `\nIf this release raised a major, raise MINIMUM_COMPATIBLE_PACKAGE_VERSION in\n`
      + `${path.join('apps', 'api', 'src', 'contracts', 'shared-packages.ts')} to ${version} and deploy the backend.\n`
    );
  }
}

main();
