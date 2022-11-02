FROM node:18
WORKDIR /test
COPY package.json pnpm-lock.yaml tsup.config.ts README.md tsconfig.json vitest.integration.config.ts .npmrc /test/
RUN corepack enable
RUN pnpm install
COPY src /test/src
RUN pnpm run build-all
CMD ["pnpm", "run", "test-build-integrations", "--reporter=verbose"]