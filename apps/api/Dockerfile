# Build context is the REPO ROOT, not apps/api — a pnpm workspace package
# can't be installed in isolation; this needs the root pnpm-lock.yaml,
# pnpm-workspace.yaml, and every workspace package's own package.json to
# resolve correctly. See docker-compose.prod.yml's `build.context`.
#
# NOTE — Phase 9, stated honestly: this Dockerfile has NOT been verified
# with a real `docker build` in this session — Docker isn't usable on the
# dev machine this was written on (not on Windows PATH, not in WSL2; the
# same installation trouble documented in the root README's Phase 0
# section). Written carefully against this project's own established
# Dockerfiles (services/ocr/Dockerfile, services/biometrics/Dockerfile)
# and pnpm's documented workspace-install behavior, but the first real
# build is the operator's own job.

FROM node:20-slim AS builder
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

# Deliberately NOT using `pnpm deploy` here, despite it being pnpm's own
# purpose-built command for producing a flattened, portable node_modules
# for exactly this situation — its interaction with Prisma's generated-
# client output (written into the pnpm store by `prisma generate` above,
# not part of the npm-resolvable dependency tree `deploy` reconstructs
# from the lockfile) can't be verified without a working Docker install
# here, and a broken Prisma client is a silent-until-runtime failure mode.
# Pruning devDependencies in place after build/generate are already done
# is less elegant (ships a larger image — every workspace package's
# node_modules, not just api's) but is something to reason through with
# confidence without executing it: the generated client and compiled
# dist/ are already on disk, and removing devDependency packages doesn't
# touch either.
RUN pnpm install --prod --frozen-lockfile

FROM node:20-slim AS runtime
WORKDIR /repo
COPY --from=builder /repo ./
ENV NODE_ENV=production
EXPOSE 3000
# node:20-slim ships a built-in non-root `node` user for exactly this.
USER node
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/src/main.js"]
