// ESLint 9 flat config.
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    // Compiled output and dependencies. `*.js` covers this config file itself,
    // which is CommonJS and not part of the TypeScript project.
    ignores: ['node_modules/**', 'cdk.out/**', 'dist/**', 'coverage/**', '**/*.js', '**/*.d.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // CDK constructs are instantiated for their side effect on the tree; the
      // returned object is often unused on purpose (`new cdk.CfnOutput(...)`).
      'no-new': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  }
);
