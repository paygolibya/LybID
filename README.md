# LybID

Self-hosted, multi-tenant identity verification (KYC/KYB) API platform for Libyan banks and fintechs. Built by Marsa — "Sumsub, but for Libya."

Everything runs on infrastructure we control: no per-verification calls to paid third-party APIs (Rekognition, Jumio, Onfido). This is deliberate, not a cost shortcut — it keeps cost-per-verification low and keeps customer data inside infrastructure we control, which matters because Libyan banks care that verification data never leaves Libya.

## Phase 0 — Scaffolding & Multi-Tenant Core

This phase builds no verification logic. It builds the foundation: tenant management, API-key authentication for the tenant-facing API, and tenant isolation enforced at two layers — application code and Postgres Row-Level Security.

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Docker Desktop (for local Postgres) — **or**, if Docker isn't available (e.g. it needs admin/UAC rights you don't have on the box you're on), a portable native Postgres works just as well: download the "Windows x86-64 binaries" zip from [enterprisedb.com/download-postgresql-binaries](https://www.enterprisedb.com/download-postgresql-binaries) (no installer, no admin rights needed), then:
  ```bash
  unzip pg.zip -d ~/pgportable && cd ~/pgportable/pgsql
  echo lybid_owner_dev_password > ../pwfile.txt   # initdb.exe is a native binary — it can't read
                                                   # a bash process-substitution fd, use a real file
  ./bin/initdb.exe -D data -U lybid_owner --pwfile=../pwfile.txt -E UTF8 --locale=C
  ./bin/pg_ctl.exe -D data -l logfile -o "-p 5432" start
  ./bin/psql.exe -h 127.0.0.1 -p 5432 -U lybid_owner -d postgres -c "CREATE DATABASE lybid OWNER lybid_owner;"
  ```
  Everything downstream (migrations, seed, app, tests) is identical either way — both just need something answering to `DATABASE_URL`/`RUNTIME_DATABASE_URL` on `localhost:5432`. Note: `pg_ctl start` runs the server as a plain background process tied to your shell/user, not a Windows service — it won't survive a reboot and needs `pg_ctl stop` / a fresh `start` per session, unlike Docker Desktop's own persistence.

### Setup

```bash
pnpm install

# copy the env template into apps/api — Prisma CLI reads .env from the
# directory it's run in, and commands run there via `pnpm --filter api`
cp .env.example apps/api/.env

pnpm db:up                       # starts Postgres via docker-compose
pnpm --filter api prisma:migrate # runs both migrations: schema, then the
                                  # lybid_app role + RLS policies
pnpm --filter api prisma:seed    # bootstraps the first platform admin
                                  # from ADMIN_BOOTSTRAP_EMAIL/PASSWORD
pnpm dev                         # starts the API on :3000 (docs at /docs)
```

### Two database roles — why

`DATABASE_URL` (the `lybid_owner` role) is used **only** by `prisma migrate` and the seed script. `RUNTIME_DATABASE_URL` (the `lybid_app` role) is what the running app connects as. This split exists because Postgres exempts a table's *owner* from Row-Level Security by default — if the app connected as the owner, the RLS policies in the `2_rls_setup` migration would silently do nothing. The app must connect as a non-owner role for tenant isolation to actually be enforced at the database level.

### Testing

```bash
pnpm --filter api test        # unit tests (no DB required)
pnpm --filter api test:e2e    # e2e tests — requires `pnpm db:up` and migrations applied
```

The e2e suite includes `rls-bypass.e2e-spec.ts`, which connects directly as the `lybid_app` role and issues raw SQL — bypassing the app's own tenant-scoping code entirely — to prove isolation holds at the database level, not just in application logic.

## Phase 1 — Document OCR (Passport + Birth Certificate)

Tenants create Applicants and upload passport/birth-certificate documents for self-hosted OCR extraction (Tesseract, PassportEye for passport MRZ checksum validation). Async — upload returns `202` immediately, a BullMQ worker calls the OCR sidecar and writes results, client polls for status.

### Additional prerequisites

- **Redis** (queue) — `redis-server` on `REDIS_URL`. On Linux/WSL: `apt-get install redis-server`. On Windows without Docker: run it inside WSL2 (`wsl --install -d Ubuntu`, no admin needed if the WSL feature is already enabled, then `sudo apt-get install redis-server` — systemd starts it automatically; WSL2 auto-forwards the port to Windows `localhost`).
  - **WSL2 gotcha**: the WSL2 VM auto-suspends a few seconds after the last attached `wsl.exe` process detaches — and takes Redis down with it, silently, even though `redis-server` is an enabled systemd service. From Windows this looks exactly like Redis randomly going up and down. Keep the VM alive for the duration of your dev session with a trivial attached process: `wsl.exe -d Ubuntu -- sleep infinity` (run in the background; killing it lets the VM idle out again).
- **MinIO** (document storage) — via docker-compose, or the portable no-installer binary: download [`minio.exe`](https://dl.min.io/server/minio/release/windows-amd64/minio.exe), then:
  ```bash
  MINIO_ROOT_USER=lybid_minio MINIO_ROOT_PASSWORD=lybid_minio_dev_password \
    ./minio.exe server ./data --console-address ":9001"
  ```
  `MINIO_USE_SSL` in `.env` must parse to a real boolean — Zod's `z.coerce.boolean()` on the *string* `"false"` produces `true` (JS's `Boolean("false") === true`), which makes the MinIO client attempt TLS against a plain HTTP server and hang indefinitely rather than error. `env.validation.ts` uses an explicit string-enum parser (`envBoolean`) for this reason — don't swap it back to `z.coerce.boolean()`.
- **`services/ocr`** (OCR sidecar) — Python 3.11+, Tesseract (with `ara`+`eng` trained data), poppler-utils (for PDF rasterization). On Windows, the cleanest path is running this inside the same WSL2 Ubuntu instance as Redis (`sudo apt-get install tesseract-ocr tesseract-ocr-ara poppler-utils`, then `pip install -r services/ocr/requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 8000` from `services/ocr`, run as a persistent background process so it survives) — Tesseract/OpenCV's Linux packaging is far less friction than hunting down Windows builds, and it mirrors how this runs in any real (containerized) deployment anyway.

### BullMQ connection config — two silent-failure traps

Both of these produce no error, no crash — jobs are enqueued but the worker never picks them up (or vice versa), which just looks like the pipeline hanging:
1. `connection` must be a plain ioredis options object (`{ host, port }`), not `{ url: '...' }` — ioredis's `RedisOptions` has no `url` field, so that shape is silently ignored and it falls back to defaults (which happen to work locally, masking the bug).
2. `maxRetriesPerRequest: null` is required on the connection — BullMQ Workers use blocking Redis commands that need it.

See `src/queue/queue.module.ts` for the working config.

### Another trap: two workers on one queue looks like a flaky test, isn't

If a previous `pnpm dev` (or a previous `jest` run that didn't fully exit — e.g. Windows not tearing down a `nest start --watch` process tree cleanly) is still alive in the background, it's still a live BullMQ Worker connected to the same Redis, competing with whatever you're running now to consume jobs from `document-extraction`. It'll process a *new* test's job using the *old* process's config (the real `OcrClientService`, not that test's stub) and write a result that looks like flaky cross-test contamination — same symptom as a genuine race condition, wrong diagnosis if you chase it as one. Confirm with `Get-Process node | Where Path -eq "...\nodejs\node.exe"` before spending time on timing theories; kill stragglers and retest clean first.

### Setup (in addition to Phase 0's)

```bash
# same apps/api/.env now also needs REDIS_URL, OCR_SERVICE_URL, MINIO_* — see .env.example
pnpm --filter api prisma:migrate   # applies the new applicants/documents/document_extractions
                                    # schema + RLS migrations on top of Phase 0's
```

### Testing

```bash
pnpm --filter api test:e2e   # runs with --forceExit — document-upload.e2e-spec.ts boots a real
                              # BullMQ queue/worker, and jest otherwise waits indefinitely for
                              # those Redis connections to close even after app.close()
```

`document-upload.e2e-spec.ts` stubs `OcrClientService` (overridden via Nest's testing module) rather than depending on the real Python sidecar — it proves the upload → queue → worker → tenant-transaction plumbing end to end, including the `NEEDS_REVIEW` confidence-threshold path and BullMQ retry-on-sidecar-failure behavior. `applicant-document-isolation.e2e-spec.ts` covers cross-tenant and cross-environment (LIVE/TEST) isolation for the new models. `services/ocr` has its own pytest suite against synthetically generated fixtures (`services/ocr/tests/generate_fixtures.py`) — no real document images are ever committed to this repo.

Both were also verified against the **real** OCR sidecar (not stubbed) with the synthetic fixtures: passport extraction — MRZ + ICAO checksums via PassportEye — reached `EXTRACTED` with `overallConfidence: 1.0` and all fields correct. Birth certificate extraction correctly OCR'd the Arabic text (`rawText` was accurate) but the keyword-anchored field heuristic mismatched — it grabbed part of a label as a field's value instead of the adjacent value box. This is the untuned-heuristic risk the Phase 1 plan flagged in advance, now confirmed concretely: the birth-certificate extraction path works end-to-end but its *field-level accuracy* is not yet reliable, and it will need tuning against a real (redacted) sample before being trusted over `NEEDS_REVIEW` — don't take a `status: EXTRACTED` on a birth certificate as a high-confidence result yet, regardless of the confidence score attached.

### Roadmap

0. Scaffolding & multi-tenant core (this phase)
1. Document OCR (passport + birth certificate, self-hosted Tesseract)
2. Biometric liveness + face match (self-hosted)
3. KYB (business document verification)
4. Workflow/decisioning + manual review queue
5. Usage-based billing
6. Client capture SDK
7. Bank-facing admin dashboard
8. Security/retention/audit hardening
9. Self-hosted deployment packaging

Phases 6 and 7 (any user-facing screen) must be modern, Sumsub-grade UI/UX — React + a real design system, not dated server-rendered forms.
