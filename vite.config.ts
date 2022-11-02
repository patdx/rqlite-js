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
    include: ['**/*.{test,spec,unit}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test/unit/unit-test-setup.ts'],
    // ...
  },
});
