import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/node_modules/**', 'out/**', 'release/**', 'coverage/**', 'test-results/**', 'playwright-report/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/recovery/**/*.ts', 'tests/**/*.{ts,mjs}', '*.config.{ts,mts,mjs}'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['node:*', 'electron', 'electron/**', 'better-sqlite3', 'better-sqlite3/**', 'argon2', 'argon2/**', '**/main/**', '**/recovery/**'],
          message: 'Renderer must use the typed preload API.'
        }]
      }]
    }
  }
)