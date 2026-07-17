import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist', 'dist-android', 'android', 'coverage', 'node_modules', '*.tsbuildinfo']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts', 'playwright.config.ts', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.es2022,
        __APP_VERSION__: 'readonly',
        __BUILD_DATE__: 'readonly'
      }
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    files: ['playwright.config.ts', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node
    }
  }
)
