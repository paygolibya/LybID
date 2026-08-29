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
