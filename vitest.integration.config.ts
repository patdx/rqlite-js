/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    // reporters: 'dot',
    // reporters: ['default', 'verbose', 'json'],
    // outputFile: {
    //   json: './test.json',
    //   verbose: './test.out',
    // },
    // threads: true,
    // minThreads: 1,
    // maxThreads: 1,
    // maxConcurrency: 1,
    // threads: false,
    // globals: true,
    include: ['**/*.integration.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    testTimeout: 30000,
    // setupFiles: ['src/test/unit/unit-test-setup.ts'],
    // ...
  },
});
