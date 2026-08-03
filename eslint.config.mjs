import eslint from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/core/**',
      'packages/cli/**',
      'packages/web/server.js',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['packages/backend/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/web/app.js', 'packages/web/vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // app.js is an HTML-event-handler entry point: many functions are
      // intentionally referenced by rendered onclick attributes rather than
      // by another JavaScript expression in the same file.
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['packages/web/manual-course-scope.mjs', 'packages/web/test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
