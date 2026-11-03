/** End-to-end API suite: `npm run test:e2e`. The real app on an in-memory MongoDB seeded with the provided dataset. */
export default {
  testEnvironment: 'node',
  transform: {},
  roots: ['<rootDir>/scripts'],
  testMatch: ['**/e2e-api.test.js'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  setupFiles: ['<rootDir>/tests/setup/env.js', '<rootDir>/scripts/e2e-env.js'],
  testTimeout: 30_000,
  verbose: true,
};
