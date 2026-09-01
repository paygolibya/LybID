# Security posture

This is a **self-review by an AI coding agent** (dependency audit + a
targeted manual pass over the architecture), not an independent
third-party security audit or penetration test. Treat it as a useful
input before one, not a substitute — a system handling government ID
documents and biometric data for banks should have real, authorized
adversarial testing by a human security professional before going live
with real customers. See "What a real pentest should target" below for
where that effort would be best spent, given this system's actual shape.

## Dependency audit (`pnpm audit`)

Run across the whole workspace. 45 advisories at the time of this review,
triaged by whether the vulnerable code path is actually reachable in a
**running deployment** — most are not:

- **Dev/build-tooling only, never reaches a running container** (the
  large majority — `vite`, `vitest`, `@nestjs/cli`'s bundled `webpack`,
  `glob` CLI, `node-tar`, `tmp`, `js-yaml`, `picomatch`, `lodash`): these
  are transitive dependencies of things like `@nestjs/cli`, `vite`,
  `vitest` — code that runs during `pnpm build`/`pnpm test`/`pnpm dev` on
  a developer's own machine, never imported by the compiled `dist/`
  output that actually ships in `apps/api/Dockerfile`'s runtime stage or
  the nginx-served static build in `apps/admin-dashboard/Dockerfile`.
  Real findings worth knowing about (e.g. `vitest`'s UI-server arbitrary
  file read is *critical* if you ever run `vitest --ui` on a network
  reachable from someone untrusted — don't), but not production risk.
- **`body-parser` (low)** — DoS via a malformed body-size-limit value
  silently disabling enforcement. Reachable at runtime (underlies every
  NestJS request), but this app never sets a custom limit value, so the
  specific trigger condition doesn't apply here. Left as-is; worth
  re-checking if a custom `limit` is ever configured later.
- **`multer` (3× high — fixed)**: genuinely reachable at runtime.
  `FileInterceptor` from `@nestjs/platform-express` is used on the real
  document-upload endpoints (`documents.controller.ts`,
  `business-documents.controller.ts`) — this is exactly the kind of
  untrusted-input surface these DoS advisories (incomplete cleanup,
  resource exhaustion, uncontrolled recursion on deeply nested field
  names) matter for. `@nestjs/platform-express@10.4.22` still pins a
  vulnerable `multer@2.0.2`; fixed here via a `pnpm.overrides` entry in
  the root `package.json` forcing `>=2.2.0` (resolved to `2.3.0`).
  Verified: full 87-test e2e suite (which exercises real multer uploads)
  still passes after the bump.

Re-run `pnpm audit` periodically — this list will drift as new
advisories land.

## Manual review pass

- **Secrets in git history**: checked (`git log -p --all -- .env` and
  friends) — none found. `.env`/`.env.local` were already gitignored, but
  the pattern didn't cover other locally-generated env files (e.g. a
  `.env.docker-test` created while smoke-testing the Phase 9 deployment
  stack, with real random secrets) — one `git add -A` away from being
  committed. Widened to `.env*` with explicit re-allows for the two
  committed templates (`.env.example`, `.env.production.example`).
- **Multi-tenant isolation**: enforced at two independent layers (Prisma
  extension + Postgres RLS), and there's a dedicated e2e suite
  (`rls-bypass.e2e-spec.ts`) that connects as the runtime role and issues
  raw SQL bypassing the app entirely, specifically to prove isolation
  holds at the database level and not just in application code. This is
  the single most important property for a multi-bank platform and it's
  the most rigorously tested part of the system.
- **Auth token handling**: three independent auth modes (tenant API key,
  admin JWT, applicant-session JWT), each with its own secret, and
  verified live (not just from reading the code) that a session token
  can't be used as an API key, can't reach admin routes, and can't mint
  another session token.
- **Rate limiting**: present on the one genuinely public,
  credential-guessable endpoint (`POST /admin/auth/login`), backed by
  Redis so it's correct across multiple API replicas, not just one.
  Every other write-capable endpoint requires a secret obtained some
  other way first.
- **Production secret safety net**: `assertProductionSecretsAreNotPlaceholders()`
  refuses to boot with `NODE_ENV=production` if any of the four app
  secrets still equal their `.env.example` placeholder — a cheap, direct
  guard against the single most damaging deployment mistake.
- **PII erasure**: bank-triggered, deletes MinIO objects + nulls
  OCR-extracted fields, audited. No automatic retention/purge (see the
  README's Phase 8 section for why — no real retention period has ever
  been given).

## Load testing

Real load, not estimated — `autocannon` against the actual running local API (dev-mode `pnpm start:dev`, a single process on a shared dev machine, not a production-compiled build under production resources; treat these as a floor, not a ceiling):

- **`/health` baseline**: ~1,720 req/sec average at 20 connections (p50 10ms, p99 24ms) — the framework/HTTP-stack ceiling with no DB work.
- **`/v1/applicants` (authenticated, RLS-scoped — the realistic case)**: ~432 req/sec average at 20 connections (p50 43ms, p99 75ms); ~470 req/sec at 100 connections (p50 205ms, p99 302ms). Latency climbs under heavier concurrency but throughput doesn't collapse and there were zero errors at either level — graceful degradation, not failure, up to the concurrency actually tested.

Not tested: sustained load over time (only short bursts), the document-upload/OCR/biometrics pipeline under load (the slowest real endpoints, not exercised here), or multi-replica behavior. A real capacity-planning exercise for a specific bank's expected traffic is still separate work.

## What a real pentest should target

Given this system's actual shape, the highest-value places for a human
security review to spend time:

1. **Cross-tenant boundary attacks** against the RLS/extension pairing
   specifically — this self-review didn't find a gap, but "we have a
   test that tries" is different from an adversarial red-team pass
   actively hunting for a bypass.
2. **The file-upload pipeline** end to end — magic-byte sniffing,
   size limits, what actually happens if a crafted PDF/image is fed to
   the real Tesseract/dlib sidecars (not just the multer layer fixed
   above).
3. **Rate limiting bypass** — is `getTracker()`'s default (client IP)
   spoofable behind whatever reverse proxy an operator puts in front of
   this, if `X-Forwarded-For` isn't configured correctly on their end?
   Worth documenting operator-side proxy configuration requirements.
4. **The admin JWT's blast radius** — no DB-backed revocation exists (by
   design, mirrors every JWT in this system), so a leaked admin token is
   valid until it expires. Worth an explicit decision on acceptable admin
   JWT lifetime for a real deployment.
5. Anything data-residency/compliance-related is outside an AI agent's
   competence to assess at all — that's a legal/regulatory review, not a
   technical one.
