import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist',
      // Static assets served verbatim by Vite (e.g. the minified PDF.js
      // worker) are vendored third-party code, not project source.
      'public/**',
      // Generated/bundled artifacts are never linted.
      '**/*.min.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
        },
      ],
    },
  },
  {
    // Maintenance scripts run under Node (require/__dirname), not the browser.
    files: ['**/*.cjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // CommonJS scripts load Node built-ins with require() by design;
      // this rule targets ES module code.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]
