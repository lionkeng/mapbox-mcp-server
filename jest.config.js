import { createDefaultPreset } from 'ts-jest';

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
export default {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/server/(.*)\\.js$': '<rootDir>/src/server/$1',
    '^@/server/(.*)$': '<rootDir>/src/server/$1',
    '^@/transport/(.*)\\.js$': '<rootDir>/src/transport/$1',
    '^@/transport/(.*)$': '<rootDir>/src/transport/$1',
    '^@/config/(.*)\\.js$': '<rootDir>/src/config/$1',
    '^@/config/(.*)$': '<rootDir>/src/config/$1',
    '^@/utils/(.*)\\.js$': '<rootDir>/src/utils/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/types/(.*)\\.js$': '<rootDir>/src/types/$1',
    '^@/types/(.*)$': '<rootDir>/src/types/$1'
  },
  globals: {
    'esbuild-jest': {
      target: 'es2022',
      format: 'esm'
    }
  },
  collectCoverageFrom: ['src/**/*.{js,ts}', '!src/index.ts'],
  testPathIgnorePatterns: ['/node_modules/', 'src/index.ts', '/dist/'],
  transform: {
    ...tsJestTransformCfg
  }
};
