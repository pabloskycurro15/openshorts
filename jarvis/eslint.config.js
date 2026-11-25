import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['apps/mobile/ios/**', '**/dist/**', '**/node_modules/**', '**/.data/**', '**/release/**', '**/public/ort/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  { files: ['apps/web/public/sw.js'], languageOptions: { globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly' } } },
  { files: ['**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly' } }, rules: { 'no-console': 'off' } },
);
