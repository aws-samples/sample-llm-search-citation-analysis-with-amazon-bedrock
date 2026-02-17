import nx from '@nx/eslint-plugin'
import tseslint from 'typescript-eslint'
import noGenericNames from './.eslint-rules/no-generic-names.js'
import noLocalTestHelpers from './.eslint-rules/no-local-test-helpers.js';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import importPlugin from 'eslint-plugin-import'
import sonarjs from 'eslint-plugin-sonarjs'
import stylistic from '@stylistic/eslint-plugin'
import react from 'eslint-plugin-react'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import unicorn from 'eslint-plugin-unicorn'
import vitest from '@vitest/eslint-plugin'
import unusedImports from 'eslint-plugin-unused-imports'

const customRules = {
  plugins: {
    custom: {
      rules: {
        'no-generic-names': noGenericNames,
        'no-local-test-helpers': noLocalTestHelpers,
      },
    },
    import: importPlugin,
    'unused-imports': unusedImports,
  },
};

export default tseslint.config(
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      'dist',
      '**/node_modules',
      'node_modules',
      'cdk.out',
      '**/cdk.out',
      '*.config.ts',
      '*.config.mjs',
      '*.config.js',
      'vitest.workspace.ts',
      '**/*.d.ts',
      '**/.vitepress/cache/**',
      '**/*.min.js',
      '**/lambda/**/.deps/**',
      '**/lambda/**/python/**',
      '**/lambda/crawler-layer/**',
    ],
  },
  eslintComments.recommended,
  {
    rules: {
      '@eslint-community/eslint-comments/no-use': ['error', { allow: [] }],
    },
  },
  sonarjs.configs.recommended,
  customRules,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'import/extensions': [
        'error',
        'never',
        {
          ts: 'never',
          tsx: 'never',
          js: 'never',
          json: 'always',
          css: 'always' 
        },
      ],

      // Custom rule: no generic names
      'custom/no-generic-names': 'error',

      // No comments - forces self-documenting code
      'no-warning-comments': 'off',
      'multiline-comment-style': 'off',
      'capitalized-comments': 'off',
      'no-inline-comments': 'error',
      'spaced-comment': 'off',

      // Prefer positive conditions in if/else and ternaries (SonarCloud S7735)
      'no-negated-condition': 'error',

      // Ban let - use const only 
      'no-restricted-syntax': [
        'error',
        {
          selector: 'VariableDeclaration[kind="let"]',
          message: 'Use const. Avoid mutation.',
        },
        {
          selector: 'NewExpression[callee.name="Error"]',
          message: 'Use custom precise error classes instead of generic Error or fail assertions in tests.',
        }
      ],
      'prefer-const': 'error',
      'no-var': 'error',

      // No any types
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Allow type assertions for JSON parsing (as T pattern)
      '@typescript-eslint/consistent-type-assertions': ['error', { 
        assertionStyle: 'as',
        objectLiteralTypeAssertions: 'never'
      }],

      // No non-null assertions - handle errors properly
      '@typescript-eslint/no-non-null-assertion': 'error',

      // SonarCloud rule equivalents
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      'import/no-duplicates': 'error',

      // Ban generic folder imports (not lib - that's NX convention)
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/utils/*', '*/utils', '*/utilities'],
              message: 'No utils folders. Use domain-specific names.',
            },
            {
              group: ['*/helpers/*', '*/helpers'],
              message: 'No helpers folders. Use domain-specific names.',
            },
            {
              group: ['*/common/*', '*/common'],
              message: 'No common folders. Use domain-specific names.',
            },
            {
              group: ['*/shared/*', '*/shared'],
              message: 'No shared folders. Use domain-specific names.',
            },
            {
              group: ['*/core/*', '*/core'],
              message: 'No core folders. Use domain-specific names.',
            },
            {
              group: ['*/src/lib/*', '*/src/lib', './lib/*', './lib', '../lib/*', '../lib'],
              message: 'No lib folders in projects. Use domain-specific names.',
            },
          ],
        },
      ],

      // Complexity limits
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      complexity: ['error', 30],

      // ESM compatibility - ban CommonJS globals
        'no-restricted-globals': [
          'error',
          {
            name: '__dirname',
            message: 'Use dirname(fileURLToPath(import.meta.url)) in ESM',
          },
          {
            name: '__filename',
            message: 'Use fileURLToPath(import.meta.url) in ESM',
          },
        ],

    },
  },
  // Naming conventions for .ts files (strict - no PascalCase variables)
  {
    files: ['**/*.ts'],
    ignores: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase'],
        },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'UPPER_CASE'],
        },
        {
          selector: 'function',
          format: ['camelCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['PascalCase'],
        },
        {
          selector: 'objectLiteralProperty',
          format: null,
        },
      ],
    },
  },
  // Naming conventions for .tsx files (allow PascalCase for React components)
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase'],
        },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['PascalCase'],
        },
        {
          selector: 'objectLiteralProperty',
          format: null,
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      '@stylistic/indent': ['error', 2],
      '@stylistic/object-curly-newline': [
        'error',
        {
          multiline: true,
          minProperties: 2,
        },
      ],
      '@stylistic/object-property-newline': [
        'error',
        {
          allowAllPropertiesOnSameLine: false,
        },
      ],
    },
  },
  // Unicorn rules (code quality)
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { unicorn },
    rules: {
      'unicorn/prefer-string-replace-all': 'error',
      'unicorn/prefer-type-error': 'error',
    },
  },
  // React and accessibility rules (eclair only)
  {
    files: ['web/src/**/*.tsx'],
    plugins: {
      react,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      'react/no-array-index-key': 'error',
      'jsx-a11y/prefer-tag-over-role': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
    },
  },
  // ErrorBoundary requires conditional rendering - disable function-return-type
  {
    files: ['web/src/components/ErrorBoundary/ErrorBoundary.tsx'],
    rules: {
      'sonarjs/function-return-type': 'off',
    },
  },
  // Eclair test files: larger limit for lint-staged compatibility
  {
    files: [
      'web/src/**/*.test.ts',
      'web/src/**/*.test.tsx',
      'web/src/**/*.spec.ts',
      'web/src/**/*.spec.tsx',
    ],
    rules: {
      'max-lines': [
        'error',
        {
          max: 730,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    plugins: { vitest },
    rules: {
      'custom/no-local-test-helpers': 'error',
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/consistent-test-it': ['error', { fn: 'it' }],
      'vitest/consistent-test-filename': ['error', { pattern: '.*\\.spec\\.[tj]sx?$' }],
      'vitest/max-expects': ['error', { max: 4 }],
      'vitest/prefer-called-with': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/require-to-throw-message': 'error',
      'vitest/prefer-spy-on': 'error',
      // Allow expect.any() matchers in tests (returns any by design)
      '@typescript-eslint/no-unsafe-assignment': 'off'
    },
  },
  // CDK infrastructure code - relaxed rules for infrastructure patterns
  {
    files: ['lib/**/*.ts', 'bin/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'max-lines': 'off',
      'no-inline-comments': 'off',
      '@stylistic/object-curly-newline': 'off',
      '@stylistic/object-property-newline': 'off',
      'no-restricted-imports': 'off',
      // CDK S3 buckets: versioning decision is context-dependent (access logs vs data)
      'sonarjs/aws-s3-bucket-versioning': 'off',
      // CDK API Gateway: health check endpoints must be public for monitoring
      'sonarjs/aws-apigateway-public-api': 'off',
    },
  },
)