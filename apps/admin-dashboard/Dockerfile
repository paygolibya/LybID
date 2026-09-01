# Build context is the REPO ROOT — same reasoning as apps/api/Dockerfile's
# own comment (a pnpm workspace package needs the root lockfile/workspace
# file present to install correctly, even though this particular package
# has no workspace-internal dependencies today).
#
# NOTE — same Phase 9 update as apps/api/Dockerfile: this HAS now been
# verified with a real `docker build` + `docker compose up` (WSL2 + apt
# Docker install, see the root README's Phase 9 section) — real traffic
# served from the running container, on the actual deployed stack. That
# run caught the healthcheck bug documented below.
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
# 127.0.0.1, not localhost — a real bug found by actually running this
# container: nginx.conf's `listen 80;` only ever binds IPv4, but Alpine's
# musl libc resolves "localhost" to ::1 (IPv6) first, so the healthcheck
# connection was refused on every single check — permanently "unhealthy"
# in `docker compose ps` even while the app served real traffic fine over
# IPv4 (which is what Docker's port mapping and a real reverse proxy both
# use). Never surfaced until something actually inspected container
# health instead of just curling the mapped port.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q -O- http://127.0.0.1:80/ || exit 1
