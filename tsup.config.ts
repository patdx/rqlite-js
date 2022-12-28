import { defineConfig } from 'tsup';
import fs from 'fs';
import _ from 'lodash';
import { format } from 'prettier-package-json';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: './dist/@patdx/rqlite-js',
  dts: true,
  splitting: false,
  // sourcemap: true,
  target: 'node16',
  clean: true,
  format: ['cjs', 'esm'],
  onSuccess: async () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

    fs.writeFileSync(
      './dist/@patdx/rqlite-js/package.json',

      format({
        ..._.pick(
          pkg,
          'name',
          'type',
          'version',
          'dependencies',
          'peerDependencies',
          'peerDependenciesMeta',
          'repository',
          'keywords',
          'author',
          'contributors',
          'license',
          'bugs',
          'homepage'
        ),
        main: 'index.cjs',
        module: 'index.js',
        types: 'index.d.ts',
      })
    );

    fs.copyFileSync('README.md', './dist/@patdx/rqlite-js/README.md');
  },
});
