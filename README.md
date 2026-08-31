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

Verified end-to-end against the real running API from a genuinely separate origin (`demo/index.html` served on `:8080` against the API on `:3000`, real session token, real browser via headless Edge with a fake camera device) — see the package README for the full account, including the `process.env` bug above and an honest note on where headless automation's limits (no interactive driving) stopped the real-camera verification short of the full capture → completion flow.

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
