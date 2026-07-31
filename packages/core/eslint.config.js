import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ['src/**/*.ts'],
  })),
  {
    files: ['src/**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // These CommonJS files are retained solver implementations. They use
      // destructuring and callback signatures whose unused values document
      // positional solver data, so keep the rollout focused on correctness
      // rules rather than rewriting stable legacy algorithms.
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // The solver API intentionally accepts untyped constraint payloads at
      // a few boundaries. Keep those explicit `any` markers visible without
      // making the initial lint rollout unusable.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
