module.exports = {
  env: {
    es2022: true,
    node: true,
    jest: true
  },
  globals: {
    before: true,
    after: true
  },
  extends: [
    'standard',
    'prettier',
    'eslint:recommended',
    'plugin:wdio/recommended'
  ],
  overrides: [],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  plugins: ['prettier', 'wdio', 'local-rules'],
  rules: {
    'prettier/prettier': 'error',
    'no-console': 'error',
    curly: ['error', 'all'],
    'local-rules/no-undocumented-service-acronyms': 'error'
  }
}
