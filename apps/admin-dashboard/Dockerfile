# Build context is the REPO ROOT — same reasoning as apps/api/Dockerfile's
# own comment (a pnpm workspace package needs the root lockfile/workspace
# file present to install correctly, even though this particular package
# has no workspace-internal dependencies today).
#
# NOTE — same Phase 9 caveat as apps/api/Dockerfile: not verified with a
# real `docker build` in this session (no working Docker install on the
# dev machine this was written on). First real build is the operator's.
#
# VITE_API_BASE_URL is a Vite *build-time* env var (baked into the static
# JS at build, not readable/overridable at container start — see this
# package's own README) — every self-hosted deployment needs its own
# image build pointed at its own API origin, there is no one generic
# pre-built image for this.
FROM node:20-slim AS builder
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lybid/admin-dashboard build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /repo/apps/admin-dashboard/dist /usr/share/nginx/html
COPY apps/admin-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q -O- http://localhost:80/ || exit 1
