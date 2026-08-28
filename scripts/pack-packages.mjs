import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PACKAGE_SCOPE,
  PUBLISHED_PACKAGES,
  lockstepVersion,
  packageDirectory,
  repositoryRoot
} from './shared-packages.mjs';

/**
 * Produces the exact tarballs `npm publish` would upload.
 *
 * Everything downstream — the scratch-project verification and the local
 * linking path — works from these rather than from `dist/`, so what is checked
 * is what a consumer would actually receive, `files` filtering included.
 */

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function packPackages(outputDirectory) {
  if (existsSync(outputDirectory)) rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  const version = lockstepVersion();
  const tarballs = new Map();

  for (const name of PUBLISHED_PACKAGES) {
    execFileSync(npm, ['pack', '--pack-destination', outputDirectory, '--silent'], {
      cwd: packageDirectory(name),
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: process.platform === 'win32'
    });
    // npm derives the file name from the package name; find it rather than
    // reconstruct it, so a naming change here fails loudly instead of quietly.
    const expected = `alishaikh110-${name}-${version}.tgz`;
    const produced = readdirSync(outputDirectory).find((entry) => entry === expected);
    if (produced === undefined) {
      throw new Error(
        `npm pack did not produce ${expected} in ${outputDirectory}. `
        + `Found: ${readdirSync(outputDirectory).join(', ') || '(nothing)'}`
      );
    }
    tarballs.set(`${PACKAGE_SCOPE}/${name}`, path.join(outputDirectory, produced));
  }

  return { version, tarballs };
}

function main() {
  const requested = process.argv[2];
  const outputDirectory = requested === undefined
    ? path.join(repositoryRoot, '.package-tarballs')
    : path.resolve(requested);
  const { version, tarballs } = packPackages(outputDirectory);
  process.stdout.write(`packed ${tarballs.size} packages at ${version}\n`);
  for (const [name, tarball] of tarballs) {
    process.stdout.write(`  ${name}  ${path.relative(repositoryRoot, tarball)}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
