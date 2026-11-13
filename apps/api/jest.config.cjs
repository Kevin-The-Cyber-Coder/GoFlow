/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Integration tests need a live PostgreSQL server and are executed through
  // `npm run test:integration`, which provisions one.
  testPathIgnorePatterns: ['\\.int\\.test\\.ts$'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.int.test.ts',
    '!src/test-utils/**',
    '!src/server.ts',
  ],
};
