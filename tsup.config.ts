import { defineConfig } from 'tsup';
import fs from 'fs';
import _ from 'lodash';
import { format, check } from 'prettier-package-json';

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  splitting: false,
  // sourcemap: true,
  clean: true,
  format: ['cjs', 'esm'],
  onSuccess: async () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

    fs.writeFileSync(
      'dist/package.json',

      format({
        ..._.pick(
          pkg,
          'name',
          'type',
          'version',
          'dependencies',
          'peerDependencies',
          'repository',
          'keywords',
          'author',
          'license',
          'bugs',
          'homepage'
        ),
        main: 'index.cjs',
        module: 'index.js',
        types: 'index.d.ts',
      })
    );
  },
});