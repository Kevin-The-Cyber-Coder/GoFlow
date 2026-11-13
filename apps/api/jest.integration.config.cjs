/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.int.test.ts'],
  clearMocks: true,
  testTimeout: 30_000,
};
