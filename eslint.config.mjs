import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'coverage/**', 'storage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  {
    // The dependency boundary. A shared package must stay importable by a
    // browser application, so it may not reach into an application, into a
    // Node built-in, or at the host environment.
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      globals: {},
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'A shared package may not read the host environment.' },
        { name: 'Buffer', message: 'A shared package may not depend on Node built-ins.' },
        { name: 'window', message: 'A shared package may not depend on a browser global.' },
        { name: 'document', message: 'A shared package may not depend on a browser global.' },
        { name: '__dirname', message: 'A shared package may not depend on a module path.' },
        { name: '__filename', message: 'A shared package may not depend on a module path.' }
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@alishaikh110/api', '@alishaikh110/worker'],
              message: 'packages/* may not import from apps/*.'
            },
            {
              group: [
                'node:*',
                'fs', 'fs/*', 'path', 'os', 'crypto', 'http', 'https', 'net', 'child_process',
                'worker_threads', 'stream', 'buffer', 'url', 'util', 'zlib', 'dns', 'tls'
              ],
              message: 'A shared package may not use a Node built-in; it must run in a browser too.'
            },
            {
              group: ['sequelize', 'sequelize/*', 'pg', 'pg/*', 'express', 'express/*', 'dotenv'],
              message: 'A shared package may not depend on a server runtime.'
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'The compiler must be deterministic: pass the time in as input.'
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'The compiler must be deterministic: pass the time in as input.'
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'The compiler must be deterministic: pass any identifier in as input.'
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: 'A shared package may not use CommonJS require.'
        }
      ]
    }
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' }
  },
  {
    // The release tooling is plain ES modules run by Node, not part of any
    // TypeScript project, so it is parsed without the type-aware service.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    }
  }
);
