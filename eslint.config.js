import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/*.config.*',
      'scaffold.mjs',
      // Native-addon manual test fixtures (CommonJS, run by hand, not app code).
      'app/native/**/test/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // TypeScript's own checker already flags genuinely-undefined identifiers, and
      // no globals are configured here, so eslint's core `no-undef` only produces
      // false positives for `process`/`console`/`window`/… (per typescript-eslint's
      // own guidance to disable it on TS projects).
      'no-undef': 'off',
      // Irregular whitespace in code is a bug, but in comments/strings it can be
      // deliberate (e.g. a zero-width space so an example `*/` can't close a JSDoc).
      'no-irregular-whitespace': ['error', { skipComments: true, skipStrings: true, skipTemplates: true }],
    },
  },
  {
    // CommonJS build scripts legitimately use `require()`.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
