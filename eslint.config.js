import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

const reactHooksCompatPlugin = {
  rules: {
    'exhaustive-deps': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Compatibility placeholder for existing react-hooks/exhaustive-deps suppressions.',
        },
        schema: [],
      },
      create() {
        return {}
      },
    },
  },
}

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.trellis/**',
      'skills/**/node_modules/**',
    ],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'test/**/*.ts', 'test/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksCompatPlugin,
    },
    rules: {
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      'no-var': 'warn',
      'prefer-const': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
]
