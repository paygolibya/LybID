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

## Phase 2 — Biometric Liveness + Face Match

An applicant uploads a selfie (via the same document-upload endpoint, `type: SELFIE`); a biometric check compares it against their passport for face match (dlib) and checks it's a live person, not a printed photo or screen replay (MiniFASNet passive anti-spoofing). Same async pattern as Phase 1: `202` immediately, a BullMQ worker calls the biometrics sidecar and writes results, client polls for status.

### Additional prerequisites

- **`services/biometrics`** — Python 3.11+, same WSL2-for-Windows approach as `services/ocr`. Needs more system packages than OCR did: `cmake`, `build-essential`, `libopenblas-dev`, `liblapack-dev` (dlib compiles from source — there's no prebuilt wheel for every platform/Python version, and the compile is genuinely slow, several minutes even with those installed).
- **dlib's companion model-data package** (`face_recognition_models`, not on PyPI — installed via its git URL) imports `pkg_resources` unconditionally. Recent `setuptools` (80+) has begun dropping `pkg_resources`; `requirements.txt` pins `setuptools<81` for this reason. If you see `Please install face_recognition_models...` despite it actually being installed, this is why — check `python -c "import face_recognition_models"` directly for the real underlying error rather than trusting that message (it's a bare `except Exception` that hides what actually failed).
- **MiniFASNet model weights** (anti-spoofing) — not committed to git (see `.gitignore`), converted from the *official* Apache-2.0-licensed `minivision-ai/Silent-Face-Anti-Spoofing` PyTorch checkpoints at build/setup time by `services/biometrics/scripts/convert_minifasnet.py`. `services/biometrics/Dockerfile` runs this conversion in its own build stage (the only place `torch` is needed — it never reaches the runtime image); for local (non-Docker) dev, run it once yourself:
  ```bash
  pip install torch --index-url https://download.pytorch.org/whl/cpu onnx onnxruntime numpy
  python services/biometrics/scripts/convert_minifasnet.py services/biometrics/app/models
  ```
  This produces **two** files — `minifasnet_v2.onnx` (2.7x-scale crop) and `minifasnet_v1se_4.0.onnx` (4.0x-scale crop). Both are required: `liveness.py` ensembles them exactly as the official project's own demo does (averages their softmax, argmax picks the verdict) — see below for why a single model alone doesn't work. `app/models/` (not `models/`) — `liveness.py` resolves the path relative to its own location inside `app/`. Getting this wrong doesn't fail loudly at startup — the ONNX sessions are only constructed lazily on the first `/verify` call, so it surfaces as a `NoSuchFile` 500 the first time a real check runs, not at service boot.

  **Why a from-scratch conversion, not a ready-made ONNX download** (this cost real debugging time during Phase 2's real-photo smoke test, worth recording so it isn't rediscovered): two independent community ONNX re-exports of this exact model — a Hugging Face upload and a separate GitHub repo's pre-built export — were both silently non-functional. Every input tried (a real selfie, random noise, an all-zeros image, an all-ones image) produced nearly bit-identical output; the exported graph wasn't meaningfully using its input at all, but nothing about loading or running it looked broken (no error, a plausible-shaped `(1,3)` softmax output). The only way this surfaced was checking whether the model's output actually *changed* across clearly-different inputs — worth doing for any third-party model weight before trusting it, not just ONNX. Converting directly from the official `.pth` checkpoints and the official model definition code (`src/model_lib/MiniFASNet.py`) removes that trust dependency.

### Test isolation: `resetQueue()` needs to run in `afterAll`, not just `beforeEach`

A `beforeEach` reset only prevents contamination *within* one spec file's own tests. `document-upload.e2e-spec.ts` and `biometric-check.e2e-spec.ts` share one Redis, and each has a "sidecar errors" test using BullMQ's exponential backoff (2s/4s) — that retry can still be sitting in Redis, delayed but not yet fired, when the spec *file* finishes and Jest moves to the next one. `app.close()` stops that file's own worker from listening, but doesn't remove the job from Redis — left alone, it gets picked up once its delay elapses by the *next* file's freshly-created (differently-configured) mock, producing a real but confusing-looking error for a job that has nothing to do with whatever's currently running. Both files now call `resetQueue()` in `afterAll` too, not just `beforeEach`.

### Setup (in addition to Phase 1's)

```bash
# same apps/api/.env now also needs BIOMETRICS_SERVICE_URL — see .env.example
pnpm --filter api prisma:migrate   # applies the new biometric_checks schema + RLS migrations
```

### Testing

`biometric-check.e2e-spec.ts` stubs both `OcrClientService` and `BiometricsClientService` — setting up test data uploads a PASSPORT document as the reference image, which enqueues a real OCR job just like any other passport upload, so this suite needs the OCR stub too even though it isn't testing OCR. Covers: auto-selecting the applicant's passport as reference vs. an explicit `referenceDocumentId`, the `NEEDS_REVIEW` threshold path (a claimed-LIVE verdict with a low score still gets flagged), `FAILED`+retry on sidecar error, wrong-document-type and missing-passport 400s, and cross-tenant 404s. `document-upload.e2e-spec.ts` gained a SELFIE case asserting the OCR extractor is *never* called for that type (the regression this guards against: an unconditional-enqueue bug would silently send selfies into Tesseract) and a SELFIE-rejects-PDF case for the type-aware MIME allow-list. `services/biometrics` has its own pytest suite (14 tests) — logic-only, mocking `face_recognition`/ONNX-session calls, since a crude synthetic image can't pass a real face detector the way Phase 1's rendered text fixtures passed Tesseract.

Verified against the real (not stubbed) `/verify` endpoint with a dummy non-face image: correctly returns `UNKNOWN` for both liveness and face match with a `no_face_detected` reason, rather than crashing — the pipeline's error handling works end to end.

**Verified end-to-end against a real, user-supplied passport (PDF) and selfie (JPEG) — never committed to this repo, used transiently for this one smoke test.** This surfaced three real bugs, all fixed:

1. **PDF reference images weren't rotation-corrected.** `pdf2image` rasterized the passport PDF sideways (no orientation metadata to correct from — same root cause class as a phone-scanned document with no EXIF rotation tag), and dlib's HOG face detector isn't rotation-invariant, so it silently found zero faces on a photo that was perfectly legible to a human. Fixed with a rotation-retry (`detect_single_face_any_rotation` in `face_match.py`, tried at 0/90/180/270°) rather than trying to fix orientation at rasterization time — cheaper, and handles a sideways *selfie* the same way for free.
2. **The crop algorithm was zero-padding a square region; the model was calibrated against a different, non-padded convention.** The official project's own `CropImage._get_new_box` caps the crop scale to the image bounds and *shifts* an out-of-bounds crop inward rather than padding — `liveness.py`'s `crop_with_scale` was rewritten to match that exactly.
3. **The liveness model was structurally broken, twice over**, only found by testing it against inputs it couldn't plausibly get right (random noise, all-zeros, all-ones) and noticing the output barely changed:
   - Two independent community ONNX re-exports of MiniFASNet were both non-functional (see the model-weights prerequisite above) — fixed by converting the official checkpoints directly.
   - Even the correctly-converted single model confidently misclassified a real live selfie as fake, because **the official project never scores a face with one model alone** — it ensembles a 2.7x-scale and a 4.0x-scale model and averages their output. Missing that produces a plausible-looking but wrong result: no error, no crash, just consistently wrong. Fixed by converting *both* official checkpoints and implementing the same two-model average. This also surfaced a fourth, smaller bug: the "live" class is index **1** in the model's 3-class output, not index 0 as an initial (third-party model card) assumption had it — confirmed by reading the official project's own decision code, not documentation.

With all four fixed: **face match is fully verified** — `faceMatchVerdict: MATCH`, correctly identifying the same person across their real passport photo and real selfie. **Liveness is structurally correct and verified working** (real two-model ensemble, matching the official algorithm exactly, tested to be genuinely input-sensitive) **but has an unresolved real-world accuracy gap**: on this one real selfie, it returned `livenessVerdict: SPOOF` at a low score, landing the overall check at `NEEDS_REVIEW` (the correct, safe outcome for a low-confidence result — not a crash or a wrong hard-fail). This is very plausibly the well-documented cross-domain generalization weakness of small anti-spoofing models (trained on a specific dataset's lighting/camera/demographic distribution, which this one real test photo may fall outside of) rather than a remaining integration bug — everything integration-side has now been checked against the official source rather than assumed. Same posture as Phase 1's birth-certificate caveat: real, working, end-to-end, but not yet trustworthy enough to skip manual review on `SPOOF`/`NEEDS_REVIEW` liveness results. A second real test photo (different lighting/camera/person) would help tell "generalization gap" apart from "still something integration-side" — worth doing before relying on this for a real decisioning workflow (Phase 4).

## Phase 3 — KYB (Business Verification)

A tenant registers a `Business` (a company, not a person) — a new top-level entity, created directly like `Applicant`, not nested under one — and uploads its business documents (Commercial Registration Certificate, Chamber of Commerce Certificate, Tax ID/Tax Card). Each is OCR'd the same way passport/birth-certificate documents are in Phase 1: `202` immediately, a BullMQ worker calls the OCR sidecar and writes results, client polls for status. Deliberately a **parallel** set of tables (`Business`, `BusinessDocument`, `BusinessDocumentExtraction`) rather than a generalized/nullable-FK reuse of `Applicant`/`Document` — `Document.applicantId` is a required FK on an already-migrated, RLS-hardened, tested table, and Phase 2's `BiometricCheck` faced the identical fork and also chose a new table over modifying `Document`.

### Setup (in addition to Phase 2's)

```bash
# no new prerequisites — same MinIO/Redis/OCR-sidecar infra as Phase 1, reused as-is
pnpm --filter api prisma:migrate   # applies the new businesses/business_documents schema + RLS migrations
```

### Testing

`business-verification.e2e-spec.ts` stubs `OcrClientService` (the same client Phase 1 uses — `DocumentsModule` now exports it for reuse, same precedent as `StorageService`'s Phase 2 reuse by `BiometricChecksModule`). Covers: upload → async OCR → `EXTRACTED`/`NEEDS_REVIEW` per confidence threshold, `FAILED`+retry on sidecar error, wrong-mime-type 400, cross-tenant 404s (both for document upload and for fetching a business directly). `services/ocr` gained three new extractors (`commercial_registration.py`, `chamber_of_commerce.py`, `tax_id.py`) sharing a new `arabic_form.py` module — the same keyword-anchored algorithm `birth_certificate.py` already used, factored out so the three new types don't each carry a near-duplicate copy (`birth_certificate.py` itself was left untouched, to avoid any risk to already-verified Phase 1 code).

**Real bug found while writing the fixtures for the three new extractors, worth recording**: an early version of each extractor's keyword list used only full 2-word Arabic label phrases (e.g. `"اسم الشركة"`) and found zero fields, even on a clean synthetic render with correct raw OCR text. Tesseract's word-level bounding boxes split most 2-word Arabic labels into separate tokens — a keyword that's only the full phrase can never be a substring of either token alone. `birth_certificate.py` avoids this by accident in places (some of its fields pair a full phrase with a single-word fallback, some don't — its own test only asserts "found *something*", so it never caught the fields that silently never match). Fixed by explicitly pairing every keyword with a single-word fallback in all three new extractors. Worth checking for the same issue if `birth_certificate.py`'s own field-level accuracy is ever tuned against a real sample.

**Same honest caveat as Phase 1's birth-certificate extraction**: the label keywords for all three new document types are best-guess Arabic terminology, **unverified against a real document** (no real KYB sample was available while building this). The pipeline runs correctly end-to-end (upload → OCR → structured response), but field-level accuracy needs tuning against a real (redacted) sample before Phase 4 (decisioning) could rely on it — don't treat a `status: EXTRACTED` on a KYB document as a high-confidence result yet, same as the birth-certificate caveat.

## Phase 4 — Workflow / Decisioning + Manual Review Queue

Every verification primitive so far (`Document`, `BiometricCheck`, `BusinessDocument`) produces its own independent result — Phase 4 rolls those up into a single `APPROVED` / `REJECTED` / `NEEDS_REVIEW` **decision** a bank can actually act on, plus a way for a human to resolve a `NEEDS_REVIEW` case. Covers both Applicant (KYC) and Business (KYB) decisioning, same pattern for each. Unlike every other phase, this one is **synchronous, not async** — deciding is pure computation over rows that already exist in Postgres, no external sidecar call, so there's no BullMQ queue/worker here at all: `POST /v1/applicants/:id/decision` (and the Business equivalent) return `201` immediately with the fresh decision.

**Trigger is explicit, not automatic**: a decision is only computed when the bank calls `POST .../decision` — nothing watches `Document`/`BiometricCheck` completions and decides on its own. Simpler and more predictable; revisit if a real automation need shows up.

**The rule, and why `REJECTED` is never automatic**: an Applicant decision requires a `PASSPORT` Document, a `BIRTH_CERTIFICATE` Document, and a `BiometricCheck` to all exist and have reached a terminal state (`400` otherwise). `APPROVED` iff all three are in their own confidently-good terminal state (both Documents `EXTRACTED`, `BiometricCheck` `COMPLETED`); `NEEDS_REVIEW` otherwise. Business decisions mirror this against the three Phase 3 KYB document types. **`REJECTED` is reachable only via manual review, for both** — deliberately, not an oversight: `BiometricCheck.status === 'COMPLETED'` already means both liveness *and* face-match passed threshold, and there's no distinct "confidently rejected" signal anywhere in the system separate from `NEEDS_REVIEW` (a clear mismatch and a borderline one land in the same bucket). Inventing an auto-reject rule the underlying data doesn't support would be the same kind of unearned confidence the Phase 2 liveness caveat already warns against.

**No bank-staff reviewer identity exists**: only a tenant's long-lived `X-API-Key` or Marsa's own admin JWT exist system-wide — there's no third "bank staff member" auth mode. The review endpoint (`POST .../decision/review`) is authenticated the same way every other tenant-facing write already is (the tenant's own API key), with the reviewer's identity supplied as a free-text `reviewerId` field the caller provides — same posture as `ApiKey.createdByAdminId` elsewhere but without an FK, since there's no matching user table. A bank's own backend/reviewer tooling calls this on the human's behalf; an actual reviewer UI is Phase 7's job. Review is restricted to resolving a currently-`NEEDS_REVIEW` decision (`400` otherwise) — overriding an already-`APPROVED`/`REJECTED` decision is a real future need, deliberately deferred.

**The review queue is a query filter, not a new resource**: `GET /v1/applicants?decisionStatus=NEEDS_REVIEW` (and the Business equivalent) *is* the manual review queue — backed by a denormalized `latestDecisionStatus` column on `Applicant`/`Business`, updated in the same transaction as each new decision row, same "current state on the parent, full history in a child table" shape `Document.status` + `DocumentExtraction` already use. Decisions themselves are append-only history (`ApplicantDecision`/`BusinessDecision`) — both an automatic `decide()` call and a manual `review()` action just create a new row; "current" is always the most recent by `createdAt`.

### Setup (in addition to Phase 3's)

```bash
pnpm --filter api prisma:migrate   # applies the new decision schema + RLS migrations
```

### Testing

`decisioning.e2e-spec.ts` covers both Applicant and Business decisioning: the `APPROVED` path, `NEEDS_REVIEW` (never auto-`REJECTED`), `400`s for missing/still-in-progress required checks, manual review resolving `NEEDS_REVIEW` → `REJECTED` then correctly blocking a second review once the latest decision is no longer `NEEDS_REVIEW`, the review-queue filter, and cross-tenant `404`s. No new sidecar involved, so no new pytest suite this phase.

Verified end-to-end against the real (non-stubbed) OCR and biometrics sidecars: uploaded a real passport + birth certificate (both reached `EXTRACTED` via real Tesseract) and a non-face selfie (correctly `UNKNOWN`/`NEEDS_REVIEW` via the real dlib/MiniFASNet pipeline, same honest behavior Phase 2 already established for a non-face image) — `POST .../decision` correctly returned `NEEDS_REVIEW` with the full reasoning trail, the manual review endpoint correctly overrode it to `APPROVED`, and a second review attempt was correctly rejected with `400` since the latest decision was no longer `NEEDS_REVIEW`.

## Phase 5 — Usage-Based Billing (Metering + Reporting)

Tracks what a tenant has actually used, so real invoicing (however Marsa does it today — manually, outside this system) has real numbers behind it. Per the user's decisions: **metering + reporting only** in this phase — no payment processor, no generated invoices, no automatic charging (real payment integration is a substantial separate effort, better suited to its own later phase once there are real paying tenants). The billable unit is **documents processed**: each `Document` (Phase 1) or `BusinessDocument` (Phase 3) that reaches a genuine OCR outcome (`EXTRACTED` or `NEEDS_REVIEW`). **`FAILED` doesn't count** — that means the OCR sidecar itself errored, not that verification work was done; billing a tenant for LybID's own infrastructure failure would be wrong.

**One unified `UsageRecord` table, unlike every prior phase's "always split into parallel Applicant/Business tables" precedent** — a deliberate exception, not an inconsistency: billing's entire purpose is a cross-tenant-level total across *both* kinds of document, so splitting would just make every reporting query `UNION` them back together. `UsageRecord` has two nullable FKs (`documentId`/`businessDocumentId`), exactly one set depending on which pipeline produced the event.

`GET /v1/usage` (tenant-facing) and `GET /admin/tenants/:id/usage` (admin-facing, any tenant) both return `{ from, to, environment, counts: { DOCUMENT_PROCESSED: n }, total }`. Default date range is the current calendar month; default `environment` is `LIVE`.

**A real design correction, caught by the e2e suite itself, worth recording**: the tenant-facing endpoint originally accepted an `?environment=` query param (mirroring the admin endpoint), on the theory that a tenant might want to see its `TEST`-key activity too. First real (not stubbed) run against it threw a 500 — the tenant-scoping Prisma extension treats an explicit `environment` filter that doesn't match the *authenticated key's own* environment as a scoping violation and refuses the query outright, which is actually correct behavior (a `LIVE` key structurally cannot see `TEST` data, by design, since Phase 1). The query param was simply nonsensical for a tenant caller — which environment they see is fixed by which key they used, not something to additionally filter. Fixed by dropping `environment` from the tenant-facing DTO entirely and always using the authenticated key's own environment; the query param stays *only* on the admin endpoint, where admin mode legitimately bypasses that scoping and can ask for either.

### Setup (in addition to Phase 4's)

```bash
pnpm --filter api prisma:migrate   # applies the new usage_records schema + RLS migrations
```

### Testing

`usage.e2e-spec.ts`: a processed document counts, a `FAILED` one doesn't, a `BusinessDocument` counts toward the same tenant total as a `Document`, a `LIVE` key's usage never includes the same tenant's `TEST`-key activity (and vice versa), the admin `?environment=` filter correctly separates a tenant's `LIVE` and `TEST` usage, usage is isolated per tenant, and an admin's view of a tenant's usage matches what that tenant sees itself. No new sidecar involved, so no new pytest suite this phase.

Verified end-to-end against the real (non-stubbed) OCR sidecar: usage started at `0`, processing a real passport through real Tesseract brought both the tenant's own `GET /v1/usage` and the admin's `GET /admin/tenants/:id/usage` to `{ DOCUMENT_PROCESSED: 1 }` in agreement.

## Applicant-Session Auth + CORS (backend groundwork for Phase 6)

Every auth-guarded route so far requires either a bank's own long-lived `X-API-Key` or Marsa's admin JWT — neither is safe to hand to a browser. This adds a third, narrow auth mode so the (future) client capture SDK can run in an untrusted browser: a tenant's own backend calls `POST /v1/applicants/:applicantId/session-token` (guarded by its real API key — server-to-server only, never called from a browser) and gets back a token scoped to **exactly one applicant**, valid for `APPLICANT_TOKEN_EXPIRES_IN` (default `30m`). That token — not the API key — is what the browser actually uses, against a completely separate route tree: `POST/GET /v1/applicant-session/documents[/:id]` and `POST/GET /v1/applicant-session/biometric-checks[/:id]`. The existing `/v1/applicants/:id/documents` etc. routes are untouched; banks keep using their API key there exactly as before.

Signed with its own secret (`APPLICANT_TOKEN_SECRET`), deliberately separate from the admin JWT's `JWT_SECRET` — two independent trust domains, even though both are just JWTs verified server-side. No DB-backed revocation (mirrors the existing admin-JWT precedent — pure signed-expiry, no session table); the short expiry is the mitigation for a leaked token, not a blocklist. The two `POST` routes take `applicantId` from the token claim, never a URL param — there's no "does the URL match the token" check to get wrong, it's structurally impossible to act on behalf of a different applicant. The two `GET`-by-id routes (no `applicantId` in their URL, by original design) check the fetched resource's `applicantId` against the token's after lookup, `404`ing (not `403`) on mismatch — the same "don't confirm the resource exists" idiom used everywhere else in this codebase.

**Two real bugs this surfaced, found by reading the code, not guessed** — adding a third `RequestAuthContext` mode broke two places that silently assumed only two existed:
1. `RequestTransactionInterceptor` dispatched with `if (auth.mode === 'tenant') {...} else {...admin...}` — a non-exhaustive `if/else`, not a `switch`. Left as-is, an `'applicant'`-mode request would have silently fallen into the `else` branch and opened an **admin transaction**, bypassing all tenant scoping for a token whose entire purpose is to be *more* restricted than a tenant key. Fixed with an exhaustive `switch` (`never`-typed default), so a future fourth mode is a compile error here too, not another silent gap.
2. `prisma-tenant.extension.ts`'s scoping helper was typed to accept only the `'tenant'` variant — adding a third union member broke that type outright (a real compile error, not a subtle bug) once `applicant`-mode auth started flowing through the same code path. Fixed by widening it to a small structural type both `'tenant'` and `'applicant'` satisfy; the *finer* "only this one applicant" restriction is deliberately handled by `ApplicantSessionModule` itself, not this shared file — there's no generic way to know which field on which model means "applicant" across `Document`/`BiometricCheck`/etc. from here.

**CORS**: permissive (`origin: true`, reflects any origin), global, `GET`/`POST` only for now. Deliberate, not an oversight — the real protection for the new routes is the token's own scoping, not an origin allowlist; CORS is a browser-enforced restriction on reading responses, so enabling it globally doesn't expose the existing API-key/admin routes to anything a malicious page could exploit (a browser script still can't produce a secret it was never given). **A real, separate bug found only by curling a real response with an `Origin` header, not assumed**: Helmet's default `Cross-Origin-Resource-Policy: same-origin` header is a *second*, independent browser check from CORS — even with `Access-Control-Allow-Origin` correctly set, that header would have silently blocked the SDK's `fetch()` calls in real browsers (works fine in curl/Postman, breaks silently in an actual browser, since neither of those tools enforce CORP). Fixed by overriding just that one Helmet option to `cross-origin`; every other Helmet default (CSP, HSTS, etc.) is untouched.

### Setup (in addition to Phase 5's)

```bash
# apps/api/.env needs two new vars — see .env.example
# APPLICANT_TOKEN_SECRET="..."      (separate from JWT_SECRET — generate a real random value beyond local dev)
# APPLICANT_TOKEN_EXPIRES_IN="30m"
```

No migration — this phase adds no new tables.

### Testing

`applicant-session.e2e-spec.ts`: token issuance requires the real API key (`401` without one), a document uploads and processes through the token alone (no API key involved anywhere in that flow), a biometric check likewise, a garbage/malformed token is `401`, the tenant's own API key is rejected on applicant-session routes (wrong credential type entirely), a session token can't see another applicant's document (`404`), and a session token can't be used to mint another session token (issuance stays API-key-only). Full existing suite (69 tests, all 11 files) re-run repeatedly alongside this — this phase touches shared infrastructure (`RequestAuthContext`, the tenant-scoping extension, the transaction interceptor), so a regression anywhere else is exactly what those runs are for.

Verified end-to-end against the real (non-stubbed) OCR sidecar: minted a real session token via curl with a real API key, used *only* that token (no API key at all) to upload a real passport, watched it reach `EXTRACTED` via real Tesseract through the token-scoped route. Confirmed via `curl -H "Origin: ..."` against a running server that both the CORS headers and the corrected `Cross-Origin-Resource-Policy: cross-origin` header are actually present on real responses, not just believed to be.

## Phase 6 — Client Capture SDK

The embeddable widget a bank drops into its own page to actually collect documents/selfie from an applicant — the client-side counterpart to the applicant-session auth work above. `packages/capture-sdk/` (`@lybid/capture-sdk`), a new pnpm workspace package: React + Tailwind bundled into a single IIFE (`window.LybID`, loadable via a bare `<script>` tag, no bundler required on the integrator's side), rendered inside a Shadow DOM so neither the host page's CSS nor the widget's own Tailwind can leak across that boundary.

Camera-only capture for every step, including the selfie — **no file-upload fallback anywhere in the flow**, a deliberate, explicit product decision: accepting a pre-existing file would defeat the point of both the document-authenticity check and the liveness check the selfie feeds into. Capture is manual tap-to-capture with a static framing guide, not real-time auto-detection (confirmed twice). The SDK never computes or shows a pass/fail decision — decisioning stays a bank-triggered, API-key-only action (Phase 4); this widget's job ends at "submitted."

See [`packages/capture-sdk/README.md`](packages/capture-sdk/README.md) for usage, the build setup, and a real bug worth reading before touching this package's Vite config again: a passing `vite build` + `tsc --noEmit` still shipped a bundle where `window.LybID` was `undefined` in a real browser, because React's own `process.env.NODE_ENV` check threw `ReferenceError: process is not defined` mid-IIFE — caught only by loading the actual compiled output in an actual separate browser page, not by any build-time check.

### Setup (in addition to Phase 5's)

```bash
pnpm --filter @lybid/capture-sdk build   # -> packages/capture-sdk/dist/capture-sdk.js
```

No migration, no new backend routes — this phase is pure frontend, consuming the applicant-session routes built above.

### Testing

`pnpm --filter @lybid/capture-sdk test` (Vitest): the step-sequencing state machine (11 tests) and the Welcome → capture-step transition + camera-unsupported fallback (2 tests), including an explicit assertion that no upload button or `<input type="file">` exists anywhere in the DOM.

Verified end-to-end against the real running API from a genuinely separate origin (`demo/index.html` served on `:8080` against the API on `:3000`, real session token, real browser via headless Edge with a fake camera device) — see the package README for the full account, including the `process.env` bug above. A later pass added Playwright (`test-e2e/live-flow.mjs`) and drove the *entire* flow interactively — all three captures, real OCR/biometrics processing, through to the `Submitted` screen and the host page's `onComplete` firing, zero console errors — closing the gap left by headless screenshot mode's lack of interactive clicking.

## Phase 7 — Bank-Facing Admin Dashboard

A UI for Marsa's own ops staff — not a bank self-service portal. `apps/admin-dashboard/` (`@lybid/admin-dashboard`), a normal Vite + React + Tailwind SPA (not IIFE/library mode like `capture-sdk` — a real app build, served as its own site), authenticated with the existing admin JWT (`POST /admin/auth/login`), the same credential every `/admin/*` route has always required. Banks still have no login of their own — that would need a new `TenantUser` auth system, deliberately out of scope: this phase gives Marsa's ops staff a UI over what already existed only as `curl` commands, not a self-service portal for bank staff.

**The real backend gap this phase actually needed to fix**: every existing read for applicants/businesses/decisions relies on the tenant-scoping Prisma extension auto-injecting `tenantId` from the caller's API key — that auto-injection never happens under admin auth (admin mode intentionally bypasses it and relies on Postgres RLS's `*_admin_all` policies, which permit reading *any* tenant's rows). So there was no way for an admin JWT to browse one specific tenant's data at all before this phase — `admin-jwt.guard.ts`'s own comment had flagged this in advance ("no bank-facing dashboard yet, that's Phase 7"). Fixed with a batch of new, explicitly-tenant-filtered admin routes (`GET/POST /admin/tenants/:tenantId/applicants[/:id[/decision[/review]]]`, mirrored for `businesses`) — every one of them checks the fetched row's `tenantId` against the route param and 404s on mismatch before doing anything else, the same "don't confirm existence" idiom the applicant-session work established in Phase 6. Applicant/business detail is a single aggregate read (`ApplicantsService.getDetailForTenant`/`BusinessesService.getDetailForTenant`) built via Prisma relation `include`s rather than composing several service calls — one round trip for the whole detail page.

**A second, genuinely new capability**: no document had ever been served back out of this system before — MinIO was purely internal, written by upload and read only by the OCR/biometrics sidecars. The manual review queue is close to useless without a human actually seeing the flagged passport/selfie image, so this phase adds `GET /admin/tenants/:tenantId/documents/:id/image` (and the `business-documents` equivalent): a **backend-proxied stream**, not a presigned MinIO URL handed to the browser — the raw MinIO URL/credentials never reach the browser, and every view goes through the same `AdminJwtGuard` check as any other admin action, with nothing resembling a bearer URL that could leak via browser history/logs/a shared screen. The dashboard fetches it as an authenticated `Blob` and renders it via `URL.createObjectURL` (see `AuthenticatedImage.tsx`) — a plain `<img src>` can't carry the `Authorization` header this needs.

**A real bug this surfaced, caught by the new e2e suite, not guessed**: `ApplicantDecisionsService.decide()`/`.review()` (and the `BusinessDecisionsService` equivalents) create their decision rows relying on that same tenant-scoping extension to auto-inject `tenantId`/`environment` — which, like the reads above, silently does nothing under admin auth. Calling the admin-triggered decide/review routes threw a real `PrismaClientValidationError: Argument tenantId is missing` the first time they actually ran against Postgres, not something `tsc`/`vite build` could have caught. Fixed by sourcing `tenantId`/`environment` explicitly from the already-fetched `applicant`/`business` row in both services, which is correct under every auth mode (tenant, applicant-session, and admin) rather than relying on which auth mode happens to be calling.

**Reviewer identity is real, not free text, for admin-triggered reviews**: `AdminJwtGuard`'s auth context was widened from `{mode:'admin', adminId}` to also carry `email` (already decoded from the JWT payload, just not forwarded before), and the new `POST .../decision/review` admin route sources `reviewerId` from the authenticated admin's own email rather than accepting it from the request body — `AdminReviewApplicantDecisionDto`/`AdminReviewBusinessDecisionDto` don't even have a `reviewerId` field for a caller to set.

**Explicitly deferred, not an oversight**: an audit-log read endpoint. `AuditLogService`'s own comment already said this was "write-only for Phase 0 — no read endpoint or retention policy yet (both are Phase 8 decisions)" — a call made before this project even had a phase list this granular, and Phase 8 (next) is exactly where it belongs. This dashboard has no audit-trail view.

See [`apps/admin-dashboard/README.md`](apps/admin-dashboard/README.md) for the dashboard's own usage/testing notes.

### Setup (in addition to Phase 6's)

```bash
pnpm --filter @lybid/admin-dashboard dev   # http://localhost:5174, needs VITE_API_BASE_URL (defaults to localhost:3000)
```

No migration — this phase adds no new tables, only new routes/services plus the small `AdminJwtGuard` auth-context widening.

### Testing

`test/e2e/admin-dashboard.e2e-spec.ts` (backend): every new admin route's cross-tenant case 404s (list, detail, decide, review, image — the ownership-check bug class this phase's own comments call out), an admin-triggered decide+review producing a real `NEEDS_REVIEW` → `APPROVED` transition with `reviewerId` equal to the admin's real email (not client-supplied), the image endpoint returning the real uploaded bytes with the right `Content-Type`, and every route rejecting a request with no admin JWT at all. Full suite (12 files, 75 tests) re-run alongside this, since this phase touches shared decisioning-service code.

`@lybid/admin-dashboard`'s own Vitest suite (5 tests) covers the API client's auth-header wiring and error handling, and the login → redirect flow. Verified end-to-end against the real running API in a real browser: logged in for real, created a real tenant/API key/applicant, uploaded a real document, and confirmed the tenant-detail and applicant-detail pages render real data — including the image-proxy pipeline actually returning and rendering real image bytes, the highest-risk new code path this phase added. See the package README for the full account.

## Phase 8 — Security / Retention / Audit Hardening

The last hardening pass before Phase 9 (self-hosted deployment packaging). Three gaps this project carried since early on, each already flagged in an existing code comment before this phase closed them:

**Audit**. `AuditLogService` gets a `GET /admin/audit-log` read endpoint (`tenantId?/targetType?/targetId?/action?/from?/to?/limit?` filters, capped at 500 — the one table here with no natural per-tenant growth bound) — its own Phase 0 comment had deferred this explicitly. Two changes made it usable beyond its original tenant/API-key call sites: `record()` now falls back to the plain (non-transactional) Prisma client when no request transaction is open yet (`POST /admin/auth/login` has no guard, so no transaction exists at the point a login attempt needs auditing — safe specifically because `audit_logs` has no RLS, confirmed in the `rls_setup` migration's own comment), and `actorType` widened from `'platform_admin'`-only to also accept `'tenant'`, with a new nullable `tenantId` column so the read endpoint can actually filter to one tenant's trail. New entries recorded: every admin login attempt (success *and* failure — the one piece of brute-force-relevant telemetry this system didn't have), every decision review (whether made via a tenant's own API key or the Phase 7 admin dashboard — both flow through the same service method), and every erasure (below).

**Security**. `@nestjs/throttler`, wired globally with a moderate default (100 req/min) plus a strict override (5/min) on `POST /admin/auth/login` — the one truly public, credential-guessable endpoint in the whole platform, previously unthrottled. Also a startup safety check (`assertProductionSecretsAreNotPlaceholders`, `main.ts`): refuses to boot with `NODE_ENV=production` if `JWT_SECRET`/`API_KEY_PEPPER`/`APPLICANT_TOKEN_SECRET`/`ADMIN_BOOTSTRAP_PASSWORD` still equal their literal `.env.example` placeholder values — a cheap, direct guard against the single most damaging deployment mistake this platform could make.

**Retention — bank-triggered erasure, confirmed with the user first**. This project has never been told a real regulatory retention period, and KYC/banking data usually has to be *kept*, not deleted on request — in tension with GDPR-style erasure. So Phase 8 built only what was confirmed: `POST /v1/applicants/:id/erase` and `POST /v1/businesses/:id/erase` (tenant API-key only — not reachable via an applicant-session token, no admin-dashboard mirror this phase), which delete every associated document's MinIO object and null its OCR-extracted PII, and null the applicant's/business's own declared identity fields. **Deliberately does not** touch `ApplicantDecision`/`BusinessDecision` rows or `BiometricCheck`'s scores/verdicts — those are the compliance record the confirmed scope says must survive. No automatic time-based purge job — out of scope until there's a real retention-period answer.

A real design correction made mid-implementation, worth recording: erasure was first going to reuse `Applicant.deletedAt`/`Business.deletedAt` to mark an erased record, matching the existing soft-delete pattern — but `deletedAt` means "hidden from every read" everywhere else in this codebase (`getOrThrow`/`list()` both filter it), which would have made the "kept" decision history practically unreachable through any API the moment a record was erased, defeating the entire point of preserving it. Fixed before it shipped by adding a separate `erasedAt` marker instead — erasure purges PII and images but leaves the record (and its decision history) visible, exactly as intended.

A second real bug, caught by the e2e suite hitting real Postgres, not guessed: reusing `ApplicantDecisionsService.decide()`/`.review()` from the Phase 7 admin dashboard (added last phase) relies on the tenant-scoping extension auto-injecting `tenantId`/`environment` on `.create()` — a no-op under admin auth, which threw a real `PrismaClientValidationError` the first time an admin-triggered review actually ran. Already fixed in `45a2126`'s follow-on work, recorded here since Phase 8's own new erasure services deliberately avoided the same trap from the start (both source `tenantId`/`environment` explicitly from the already-fetched row, correct under every auth mode).

The Phase 7 admin image-proxy endpoints also gained a real fix this phase needed: a `Document`/`BusinessDocument` row can now outlive its MinIO object (once erased), so both `AdminDocumentsController`/`AdminBusinessDocumentsController` translate a missing-object error into a `404` instead of an unhandled `500`.

### Setup (in addition to Phase 7's)

```bash
pnpm --filter api prisma:migrate   # applies AuditLog.tenantId + Applicant/Business.erasedAt
```

### Testing

Three new e2e spec files (10 tests): `admin-auth-throttling.e2e-spec.ts` forces `NODE_ENV=production` around a burst of login attempts to prove the throttle guard is real, not just configured (every *other* e2e file needs throttling off — the shared test-app helper logs in as admin fresh in nearly every test's `beforeEach`, and the whole suite runs in well under a minute against one instance, which is exactly what surfaced this: a production-appropriate 5/min login limit started 429ing the test suite itself before this was scoped to production only). `audit-log.e2e-spec.ts` covers login-attempt auditing and the read endpoint's `tenantId` filter. `erasure.e2e-spec.ts` covers both applicant and business erasure: images genuinely gone (404, not 500), OCR PII nulled while the document row and its status survive, decision history untouched, the record still visible (not hidden), and cross-tenant erasure 404s. Full suite re-run alongside these (15 files, 85 tests) since this phase touches shared `AuditLogService` and CORS/boot config.

## Phase 9 — Self-Hosted Deployment Packaging

The last phase. Everything up to here ran from source with `pnpm dev`/`pnpm start:dev` and a mix of Docker and portable-binary infra — nothing was ever packaged for a bank to actually stand up on their own infrastructure. This phase closes that: real Dockerfiles, a full deployment compose stack, a production env template, and this walkthrough.

**Originally written without a working Docker install** — the same WSL2/UAC trouble documented in Phase 0 — and shipped unverified. **Update: since fixed and actually run for real.** Docker now works on this machine via WSL2 + `apt` (`docker.io` + `docker-compose-v2`, not Docker Desktop — that path is still the one that failed repeatedly here) instead of the previously-blocked path. With a real Docker install, this phase got a real `docker compose build`, a real `docker compose up`, real migrations against a real Postgres in a container, and a real smoke test (an admin login through the deployed stack returning a working JWT) — not just careful reading. That real run is exactly what caught the bugs called out below (openssl, the migrate/seed command paths, the healthcheck) — every one of them was invisible to review and only surfaced by actually executing the thing. If you hit something this pass didn't catch, that's still a real possibility for infrastructure code — please open an issue rather than assume it's fully proven for every environment.

### What's new

- **`apps/api/Dockerfile`** — multi-stage: installs the whole pnpm workspace (a workspace package can't be installed in isolation), runs `prisma generate` and `nest build`. Deliberately does **not** prune devDependencies (see the bug below) and doesn't use pnpm's own `deploy` command either — `deploy`'s exact interaction with Prisma's generated-client output wasn't worth risking, and a silently-broken Prisma client is a worse failure mode than a larger image. Ships every workspace package's `node_modules`, not just `api`'s — a real, known size inefficiency, left as a future optimization.
- **A real bug fixed in passing**: `apps/api/package.json`'s `start:prod` script was `node dist/main.js` — wrong. `nest build`'s actual output is `dist/src/main.js` (no explicit `rootDir` in `tsconfig.json`, so TypeScript preserves the `src/` folder). Nobody had noticed because every session so far used `start:dev`. Fixed directly; the Dockerfile's `CMD` uses the correct path.
- **`apps/admin-dashboard/Dockerfile`** — Vite build (taking `VITE_API_BASE_URL` as a build `ARG` — it's baked into the static JS at build time, not overridable at container start, see the package's own README) into a slim `nginx:alpine` static-file stage, with an SPA-fallback `nginx.conf` (`try_files ... /index.html` — needed for React Router's client-side routes to survive a hard refresh). `@lybid/capture-sdk` is deliberately **not** containerized — it's a single static file a bank embeds on their own page, not a running service; build it and host `dist/capture-sdk.js` wherever you like.
- **`docker-compose.prod.yml`** (new — separate from the existing `docker-compose.yml`, which stays local-dev-infra-only: a dev running `pnpm start:dev` doesn't want a containerized `api` competing for port 3000). The full stack: postgres, redis, minio, ocr, biometrics, api, admin-dashboard. **No TLS anywhere in this file** — every container speaks plain HTTP; your own reverse proxy (nginx/Caddy/a cloud load balancer) terminates TLS in front of this stack. Only `api` (3000) and `admin-dashboard` (8080→80) publish a port at all.
- **`.env.production.example`** — same variables as `.env.example`, but every secret marked `GENERATE` instead of a working dev default, so copying it in unedited is obviously wrong at a glance — and `assertProductionSecretsAreNotPlaceholders()` (Phase 8) will refuse to boot if you do anyway.
- `docker-compose.yml` also gained the `biometrics` service it should have had since Phase 2 — a pre-existing gap noticed while wiring the real deployment stack, fixed here since it costs nothing extra.
- **A second real bug, found by re-reading this guide's own steps against the Dockerfile, not by running either**: the RLS-setup migration (Phase 0) creates the `lybid_app` runtime role with a hardcoded literal password, since migrations are static SQL and can't read `RUNTIME_DB_PASSWORD` from `.env` — telling operators to "generate a real one" in `.env.production.example` without a step that actually applies it to Postgres would have left the API unable to authenticate. Fixed with an explicit `ALTER ROLE` step in the deployment walkthrough below. Relatedly, `apps/api/Dockerfile` originally pruned devDependencies (`pnpm install --prod`) after build to keep the image smaller — until re-reading the deployment steps against it surfaced that `migrate deploy` and the seed script both need devDependency-only tools (`prisma`, `ts-node`) that a prune would have silently removed from the very image those commands run against. Fixed by not pruning — a real, known image-size tradeoff, but a working deploy matters more than a smaller one for a stack nobody's actually run yet.
- **`Caddyfile.example`** (repo root, added in a follow-up pass) — a concrete, minimal reverse-proxy example (Caddy auto-manages its own Let's Encrypt certificates from just two domain names, no separate ACME setup), not a requirement — nginx or a cloud load balancer's own TLS termination work exactly as well. Still not part of `docker-compose.prod.yml` itself, same reasoning as before: TLS termination stays the operator's own infrastructure decision.

### Real Docker verification (later pass) — three more bugs, only findable by running it

Once Docker actually worked here (see above), a real `docker compose build` + `up` against this whole stack surfaced three more bugs that "carefully reasoned but unexecuted" infrastructure code can hide indefinitely:

1. **`apps/api/Dockerfile` was missing `openssl`.** `node:20-slim` (Debian bookworm) ships no OpenSSL at all. Prisma's query engine shells out to `openssl version` at `prisma generate` time to pick the right engine binary; without it, it silently guessed the older `debian-openssl-1.1.x` target, which then failed at container *startup* (not build time) with `libssl.so.1.1: cannot open shared object file` — a hard crash on the very first request, invisible until something actually ran the container. Fixed by installing `openssl` in both the builder stage (so generation detects the real OpenSSL 3.0.x) and the runtime stage (so the engine's `libssl.so.3` dependency actually resolves).
2. **The deployment guide's `migrate deploy`/seed commands pointed at the wrong path.** `docker compose run --rm api node_modules/.bin/prisma migrate deploy` failed with "Cannot find module '/repo/node_modules/.bin/prisma'" — in a pnpm workspace, `prisma` and `ts-node` are devDependencies of `apps/api` specifically, so pnpm symlinks their bins into `apps/api/node_modules/.bin/`, never the repo root's (which is where the image's `WORKDIR` sits). Fixed to `sh -c "cd apps/api && node_modules/.bin/prisma migrate deploy"` (same for the seed step) — `cd`-ing into `apps/api` also gets Prisma's schema auto-discovery working for free.
3. **`admin-dashboard`'s `HEALTHCHECK` used `http://localhost/`, which never connects.** nginx's `listen 80;` only ever binds IPv4, but Alpine's musl libc resolves "localhost" to `::1` (IPv6) first — so the healthcheck was permanently "unhealthy" in `docker compose ps` even while the app served real traffic fine over IPv4 (which is what Docker's own port mapping and any real reverse proxy both use). Fixed to `http://127.0.0.1/`.

With those three fixed, the full stack (postgres, redis, minio, ocr, biometrics, api, admin-dashboard) reached `healthy` together, all 14 migrations applied, the seed script created the first admin, and a real `POST /admin/auth/login` against the running container returned a working JWT — the deployment walkthrough below is now proven to work end to end, not just internally consistent.

This same pass also ran the CI workflow's jobs for real locally via `act` (see `.github/workflows/ci.yml`'s own comment for what that found — one local-only `act`/`.env` footgun, no workflow bugs), did a security self-review (`SECURITY.md`), and ran real load tests against the API (`autocannon`) — none of that is a substitute for a genuine external pentest or a production load profile, but it's real signal from actually exercising the system rather than only reading it.

### Deploying

```bash
cp .env.production.example .env
# Edit .env: fill in every GENERATE placeholder (openssl rand -hex 32
# for the secrets), set ADMIN_BOOTSTRAP_EMAIL to a real address, and set
# ADMIN_DASHBOARD_API_BASE_URL to wherever your reverse proxy will
# actually expose the API (not localhost, unless this really is a
# same-machine smoke test).

# Run every docker compose command from the repo root — it auto-loads
# .env from the current directory for both container env vars and the
# ${VAR} substitutions inside docker-compose.prod.yml itself.
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis minio ocr biometrics

# Migrations + the first admin user, run once against the now-healthy
# database — `migrate deploy`, not `migrate dev`: the correct
# non-interactive production command, applies existing migrations only,
# never generates new ones.
#
# `cd apps/api &&`, not a bare `node_modules/.bin/prisma` from the image's
# WORKDIR — a real bug found by actually running this for the first time
# (Phase 9's Docker work): in a pnpm workspace, `prisma` and `ts-node` are
# devDependencies of apps/api specifically, so pnpm symlinks their bins
# into apps/api/node_modules/.bin/, never into the repo root's
# node_modules/.bin/ (which is where the container's WORKDIR sits). The
# original command here failed with "Cannot find module
# '/repo/node_modules/.bin/prisma'" the first time it was actually run.
# `cd`-ing into apps/api also gets Prisma's own schema auto-discovery
# (./prisma/schema.prisma relative to cwd) working with no extra flag.
docker compose -f docker-compose.prod.yml run --rm api sh -c "cd apps/api && node_modules/.bin/prisma migrate deploy"

# REQUIRED, not optional — found while writing this deployment guide:
# the RLS-setup migration creates the lybid_app runtime role with a
# hardcoded literal password ('lybid_app_dev_password'), because
# migrations are static SQL and can't read RUNTIME_DB_PASSWORD from your
# .env. Setting a real value in .env alone does NOT change what Postgres
# actually has on file for the role — this step is what actually applies
# it. Use the exact same value you put in RUNTIME_DB_PASSWORD/
# RUNTIME_DATABASE_URL. Skipping this leaves the API unable to
# authenticate as lybid_app no matter what your .env says — confirmed for
# real: the api container crash-looped with a Prisma P1000 auth error
# until this step was run.
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U lybid_owner -d lybid -c \
  "ALTER ROLE lybid_app WITH PASSWORD '<same value as RUNTIME_DB_PASSWORD>';"

docker compose -f docker-compose.prod.yml run --rm api sh -c "cd apps/api && node_modules/.bin/ts-node prisma/seed.ts"

docker compose -f docker-compose.prod.yml up -d api admin-dashboard
```

Point your own reverse proxy's TLS-terminated routes at `api:3000` and `admin-dashboard:8080`. `Caddyfile.example` (repo root) is a concrete starting point — not a requirement, just a real, minimal example (Caddy auto-manages its own Let's Encrypt certificates from just the two domain names in that file, no separate ACME setup). Distribute `@lybid/capture-sdk`'s built `dist/capture-sdk.js` to banks integrating the capture widget however you prefer (your own CDN, or served as a static file from wherever you like) — it isn't part of this compose stack.

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
