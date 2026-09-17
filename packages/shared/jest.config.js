module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Scoped to this package's own src/ — database/, messaging/, types/ and
  // utils/ are separate workspace packages nested under this directory (see
  // pnpm-workspace.yaml's "packages/shared/*" glob) and already run their
  // own `test` script; without `roots` Jest's default discovery walks into
  // them too and re-runs their suites against this package's tsconfig.
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.spec.ts'],
}
