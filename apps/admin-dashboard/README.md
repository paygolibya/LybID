# @lybid/admin-dashboard

Marsa's own internal ops dashboard — not a bank self-service portal. Authenticated with the existing admin JWT (`POST /admin/auth/login`), the same credential `curl`-based `/admin/*` management has always used; this just gives it a UI. Banks still have no login of their own — that would need a new `TenantUser` auth system, deliberately out of scope here (see the root README's Phase 7 section for the full reasoning).

## What it does

- Log in, list/create tenants, suspend/activate a tenant.
- Per tenant: issue/revoke API keys, view usage, browse applicants and businesses.
- `?decisionStatus=NEEDS_REVIEW` on the applicants/businesses list *is* the manual review queue — same "the filter is the queue" design the backend itself uses, not a separate resource.
- Applicant/business detail: every uploaded document (with its actual image, via the new admin-only image-proxy endpoint) and OCR-extracted fields, biometric check verdicts + the selfie image, full decision history, and a review form (approve/reject + notes) whenever the latest decision is `NEEDS_REVIEW`. A "Compute decision" button re-runs the same `decide()` logic a bank's own backend would call — useful for ops/support when that hasn't happened yet.

## Viewing document images

A plain `<img src>` can't carry the `Authorization` header the image-proxy endpoint requires, and putting the admin JWT in the URL as a query param would recreate exactly the bearer-URL-in-history problem the backend chose a proxied stream to avoid in the first place (see the root README). So `AuthenticatedImage` (`src/components/AuthenticatedImage.tsx`) fetches the image as an authenticated `Blob` and renders it via `URL.createObjectURL`, revoked on unmount — never a bare authenticated URL anywhere in the DOM.

## Auth

The admin JWT is held in React state and mirrored to `sessionStorage` (`src/lib/auth.tsx`) — survives a page refresh, cleared when the tab closes. Deliberately not `localStorage`, to limit how long a token persists on a shared machine. There is no refresh-token flow; the JWT's own expiry is the session length, same as every other JWT in this system.

## Build & run

```bash
pnpm --filter @lybid/admin-dashboard dev     # http://localhost:5174, needs VITE_API_BASE_URL (defaults to localhost:3000)
pnpm --filter @lybid/admin-dashboard build    # -> dist/, a normal static site (not IIFE/library mode like capture-sdk)
pnpm --filter @lybid/admin-dashboard test
pnpm --filter @lybid/admin-dashboard lint
```

`VITE_API_BASE_URL` is a build-time env var, not a runtime setting — this dashboard is deployed alongside one specific self-hosted LybID instance (see the root README's Phase 9), not a multi-instance SaaS switcher.

## Testing notes

Vitest + React Testing Library, mocking `fetch` — same tooling choice as `@lybid/capture-sdk` and the same reasoning (this is Vite-native browser-oriented testing of request/response wiring and rendering, not the backend's Jest-based Node API integration testing). `test/api-client.test.ts` covers the Authorization-header wiring (including that it reads the token via a closure, not a snapshot, so a single long-lived `ApiClient` instance keeps working across login/logout) and that a non-2xx response throws `ApiError` with the server's own message. `test/Login.test.tsx` covers the login → redirect flow and the sessionStorage-not-localStorage placement.

**Real end-to-end verification against the real running API** (not just mocked-fetch tests): logged in for real via `POST /admin/auth/login`, created a real tenant/API key/applicant, uploaded a real document, and loaded the tenant-detail and applicant-detail pages in a real browser (headless Edge) pointed at the real backend on a different port. Confirmed live: the tenant Overview tab renders real tenant data with working suspend/activate; the applicant detail page renders the real applicant, the real uploaded document's status, and — the highest-risk new code path here — the image-proxy pipeline actually returns and renders the real image bytes (no error banner, no broken-image icon; confirmed the fetch→blob→object-URL round trip works against the real endpoint, not just that the component compiles).

Unlike `@lybid/capture-sdk`'s IIFE library build, this is a normal Vite app build — the specific `process.env.NODE_ENV`-unstripped-in-library-mode bug that build caught doesn't apply here (Vite's app-mode build reliably strips it), which is part of why this package didn't need the same `define` workaround in `vite.config.ts`.

## Package layout

```
src/
  App.tsx                    # routes
  main.tsx                    # entry
  lib/
    api-client.ts               # fetch wrapper for /admin/* routes
    auth.tsx                     # AuthProvider, useAuth() — sessionStorage-held JWT
    useAsync.ts                   # shared loading/error/data fetch pattern
  components/
    Layout.tsx, RequireAuth.tsx     # shell + route guard
    Table.tsx, Badge.tsx, Button.tsx, Input.tsx, Modal.tsx, Spinner.tsx
    AuthenticatedImage.tsx            # authenticated blob -> object URL image rendering
  pages/
    Login.tsx, TenantsList.tsx, TenantDetail.tsx (tabs: Overview/API Keys/Usage/Applicants/Businesses),
    ApplicantDetail.tsx, BusinessDetail.tsx
test/                                    # Vitest
```
