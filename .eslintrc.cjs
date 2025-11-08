module.exports = {
  root: true,
  extends: ['next', 'next/core-web-vitals'],
  plugins: ['@typescript-eslint'],
  rules: {
    'react/no-unescaped-entities': 'off',
    '@next/next/no-img-element': 'off',
    '@next/next/no-assign-module-variable': 'off',
    'react-hooks/exhaustive-deps': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      files: ['middleware.ts', 'src/middleware.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'fs', message: 'Do not use fs in Edge/middleware' },
              { name: 'node:fs', message: 'Do not use fs in Edge/middleware' },
              { name: 'path', message: 'Do not use path in Edge/middleware' },
              { name: 'node:path', message: 'Do not use path in Edge/middleware' },
              { name: 'url', message: 'Do not use url in Edge/middleware' },
              { name: 'node:url', message: 'Do not use url in Edge/middleware' },
              { name: 'crypto', message: 'Use Web Crypto in Edge, not Node crypto' },
              { name: 'node:crypto', message: 'Use Web Crypto in Edge, not Node crypto' },
            ],
            patterns: [
              { group: ['lib/node/*', 'lib/**/node/*'], message: 'Do not import Node helpers in Edge/middleware' },
            ],
          },
        ],
      },
    },
  ],
};
