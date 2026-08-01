module.exports = {
  testEnvironment: 'node',
  // lib/ is in roots so that collectCoverageFrom sees files no test imports.
  // With roots limited to test/, an untested stack was simply absent from the
  // report rather than showing up as 0%, which made the threshold meaningless.
  roots: ['<rootDir>/lib', '<rootDir>/test'],
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  collectCoverageFrom: ['lib/**/*.ts', '!lib/**/*.d.ts'],
  // The suite currently reports 100% on all four metrics. The floor is set at
  // 90 so a small refactor does not turn CI red, while adding an untested stack
  // still does. CI runs `npm test -- --coverage`, so this is enforced.
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
