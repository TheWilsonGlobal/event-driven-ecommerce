module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.spec.ts'],
  // tsconfig.jest.json adds @types/jest, which the root tsconfig's
  // `types: ["node"]` otherwise excludes. See that file.
  transform: {
    '^.+\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
}
