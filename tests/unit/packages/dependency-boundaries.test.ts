import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const packagesRoot = path.join(repositoryRoot, 'packages');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'dist' || entry === 'node_modules' ? [] : sourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

function packageSources(): { readonly file: string; readonly source: string }[] {
  return readdirSync(packagesRoot)
    .map((name) => path.join(packagesRoot, name, 'src'))
    .filter((directory) => {
      try {
        return statSync(directory).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap(sourceFiles)
    .map((file) => ({
      file: path.relative(repositoryRoot, file).split(path.sep).join('/'),
      source: readFileSync(file, 'utf8')
    }));
}

function importedModules(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/gu)]
    .map((match) => match[1]!)
    .filter((specifier) => specifier.length > 0);
}

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dns', 'events', 'fs', 'http',
  'https', 'module', 'net', 'os', 'path', 'process', 'stream', 'timers', 'tls', 'tty', 'url',
  'util', 'v8', 'vm', 'worker_threads', 'zlib'
]);

const SERVER_RUNTIMES = new Set(['sequelize', 'pg', 'express', 'dotenv', 'umzug', 'sharp', 'pino']);

/**
 * The dependency boundary is what keeps the compiler shared rather than
 * forked. A package that reaches into the application, a Node built-in or the
 * host environment cannot be imported by a browser build, and the moment that
 * is true someone writes a second compiler.
 */
describe('shared package dependency boundaries', () => {
  const sources = packageSources();

  it('finds the shared package sources', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('never imports from an application', () => {
    for (const { file, source } of sources) {
      for (const specifier of importedModules(source)) {
        expect(
          { file, specifier, importsAnApp: /(^@sphere\/(api|worker)$)|apps\//u.test(specifier) },
          `${file} imports ${specifier}`
        ).toMatchObject({ importsAnApp: false });
      }
    }
  });

  it('never imports a Node built-in or a server runtime', () => {
    for (const { file, source } of sources) {
      for (const specifier of importedModules(source)) {
        const bare = specifier.replace(/^node:/u, '').split('/')[0]!;
        const forbidden = specifier.startsWith('node:')
          || NODE_BUILTINS.has(bare)
          || SERVER_RUNTIMES.has(bare);
        expect({ file, specifier, forbidden }, `${file} imports ${specifier}`)
          .toMatchObject({ forbidden: false });
      }
    }
  });

  it('never reads the host environment, a clock, or a random source', () => {
    const forbidden: { readonly pattern: RegExp; readonly why: string }[] = [
      { pattern: /\bprocess\.env\b/u, why: 'reads the host environment' },
      { pattern: /\bBuffer\s*\./u, why: 'depends on a Node built-in' },
      { pattern: /\bDate\.now\s*\(/u, why: 'reads a clock' },
      { pattern: /\bnew Date\s*\(/u, why: 'reads a clock' },
      { pattern: /\bMath\.random\s*\(/u, why: 'reads a random source' },
      { pattern: /\bwindow\./u, why: 'depends on a browser global' },
      { pattern: /\bdocument\./u, why: 'depends on a browser global' },
      { pattern: /\brequire\s*\(/u, why: 'uses CommonJS require' }
    ];
    for (const { file, source } of sources) {
      for (const { pattern, why } of forbidden) {
        expect({ file, why, matched: pattern.test(source) }, `${file} ${why}`)
          .toMatchObject({ matched: false });
      }
    }
  });

  it('detects a violation, so a clean run means something', () => {
    const violating = [
      "import { config } from '../../apps/api/src/config';",
      "import fs from 'node:fs';",
      "import { Sequelize } from 'sequelize';"
    ].join('\n');
    const specifiers = importedModules(violating);
    expect(specifiers).toEqual(['../../apps/api/src/config', 'node:fs', 'sequelize']);
    expect(specifiers.filter((specifier) => /apps\//u.test(specifier))).toHaveLength(1);
    expect(specifiers.filter((specifier) => specifier.startsWith('node:'))).toHaveLength(1);
    expect(specifiers.filter((specifier) => SERVER_RUNTIMES.has(specifier))).toHaveLength(1);
  });

  it('emits no signed URL or credential from the compiler', () => {
    const compilerSources = sources.filter(
      ({ file }) => file.startsWith('packages/experience-compiler/')
    );
    expect(compilerSources.length).toBeGreaterThan(5);
    for (const { file, source } of compilerSources) {
      for (const pattern of [/createMediaToken/u, /jsonwebtoken/u, /\bsign\s*\(/u, /expiresAt/u]) {
        expect({ file, matched: pattern.test(source) }, `${file} matched ${String(pattern)}`)
          .toMatchObject({ matched: false });
      }
    }
  });
});
