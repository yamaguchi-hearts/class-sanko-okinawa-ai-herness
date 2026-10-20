import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const generatedPaths = [
  '**/node_modules/**',
  '**/out/**',
  '**/release/**',
  '**/coverage/**',
  '**/test-results/**',
  '**/playwright-report/**'
]

const rendererRestrictedImports = {
  paths: ['electron', 'better-sqlite3', 'argon2'].map((name) => ({
    name,
    message: 'RendererからMain専用モジュールやNode APIを直接参照しないでください。'
  })),
  patterns: [{
    group: ['node:*', '**/main/**', '**/recovery/**'],
    message: 'RendererからMain/復旧専用モジュールやNode APIを直接参照しないでください。'
  }]
}

export default tseslint.config(
  { ignores: generatedPaths },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': ['error', rendererRestrictedImports]
    }
  }
)
