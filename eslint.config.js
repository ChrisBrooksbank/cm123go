import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import security from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    security.configs.recommended,
    prettier,
    {
        plugins: {
            import: importPlugin,
        },
    },
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Promoted from warn to error
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            'no-console': 'error',
            'prefer-const': 'error',
            'no-var': 'error',

            // Strict TypeScript rules
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/require-await': 'error',
            '@typescript-eslint/await-thenable': 'error',

            // Complexity guards
            complexity: ['error', { max: 20 }],
            'max-depth': ['error', { max: 4 }],
            'max-lines-per-function': [
                'error',
                { max: 100, skipBlankLines: true, skipComments: true },
            ],
            'max-params': ['error', { max: 5 }],

            // General quality rules
            eqeqeq: ['error', 'always'],
            'no-else-return': 'error',
            'no-useless-return': 'error',
            'no-return-await': 'off', // Disabled in favor of @typescript-eslint version
            '@typescript-eslint/return-await': ['error', 'in-try-catch'],

            // Import safety (catches LLM circular dependency mistakes)
            'import/no-cycle': 'error',
        },
    },
    {
        // Disable type-aware linting for config files not in tsconfig
        files: ['*.config.js', '*.config.ts', 'eslint.config.js'],
        ...tseslint.configs.disableTypeChecked,
    },
    {
        // Relax rules for test files - tests are naturally longer and use different patterns
        files: ['**/*.test.ts', '**/*.spec.ts'],
        rules: {
            'max-lines-per-function': 'off',
            '@typescript-eslint/require-await': 'off', // Test mocks often don't need await
            '@typescript-eslint/no-floating-promises': 'off', // Tests may intentionally not await
        },
    },
    {
        ignores: ['dist/', 'dev-dist/', 'coverage/', 'node_modules/', 'scripts/'],
    }
);
