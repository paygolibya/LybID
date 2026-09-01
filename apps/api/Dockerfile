# Build context is the REPO ROOT, not apps/api — a pnpm workspace package
# can't be installed in isolation; this needs the root pnpm-lock.yaml,
# pnpm-workspace.yaml, and every workspace package's own package.json to
# resolve correctly. See docker-compose.prod.yml's `build.context`.
#
# NOTE — Phase 9 update: this Dockerfile HAS now been verified with a real
# `docker build` + `docker compose up` (WSL2 + apt Docker install, see the
# root README's Phase 9 section) — a real `docker run hello-world`, then
# this whole stack, actually ran. That real run caught the openssl bug
# documented below, on top of the two found the same way in
# services/biometrics/Dockerfile (git, onnxscript). Written originally
# against this project's own established Dockerfiles (services/ocr/
# Dockerfile, services/biometrics/Dockerfile) and pnpm's documented
# workspace-install behavior, but "carefully reasoned" and "actually run"
# turned out to be different things, same as biometrics.

# openssl: a real bug found by actually running this container for the
# first time (nobody had a working Docker install to catch this before).
# `node:20-slim` is Debian bookworm and ships with NO openssl binary at
# all — `prisma generate` shells out to `openssl version` to pick the
# right query-engine binary, and Debian bookworm's actual runtime library
# is OpenSSL 3.0.x. Without this, Prisma can't detect anything, silently
# guesses the older "debian-openssl-1.1.x" target, and generates an
# engine that fails at container startup with "libssl.so.1.1: cannot
# open shared object file" — a hard crash on every request that touches
# the database, not a build-time failure, so it stayed invisible until
# the app was actually run. Needed in both stages: builder so `prisma
# generate` detects the right target, runtime so the resulting engine's
# libssl.so.3 dependency actually resolves.
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
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
#
# Also deliberately NOT pruning devDependencies with `pnpm install --prod`
# here, despite an earlier version of this file doing exactly that —
# found the hard way (by re-reading the README's own deployment steps
# against this Dockerfile, not by running it): the deployment walkthrough
# runs `node_modules/.bin/prisma migrate deploy` and
# `node_modules/.bin/ts-node prisma/seed.ts` against this same image, and
# both `prisma` (the CLI) and `ts-node` are devDependencies — a --prod
# prune would have silently made both operational commands fail with "no
# such file". Keeping devDependencies ships a larger image, a real, known
# tradeoff, but a working `migrate deploy`/seed step matters more than
# image size for a deployment nobody's actually run yet.

FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=builder /repo ./
ENV NODE_ENV=production
EXPOSE 3000
# node:20-slim ships a built-in non-root `node` user for exactly this.
USER node
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/src/main.js"]
