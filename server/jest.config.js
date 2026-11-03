/** Native ESM: no transform, run with --experimental-vm-modules (see npm test). */
export default {
  testEnvironment: 'node',
  transform: {},
  roots: ['<rootDir>/tests'],
  // One in-memory MongoDB for the whole run; each test file uses its own database.
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  testTimeout: 30_000,
};
