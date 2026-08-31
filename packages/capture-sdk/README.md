# @lybid/capture-sdk

The embeddable client capture widget — a bank drops one `<script>` tag into their own web page, calls `LybID.mount(...)`, and an applicant is walked through document + selfie capture and submission, talking directly to the bank's own LybID API instance from the bank's own origin (the CORS + applicant-session-token work exists specifically to make this safe).

## What it does — and deliberately does not do

Walks one applicant through: passport capture → birth certificate capture → selfie capture → submission. It uploads each via `POST /v1/applicant-session/documents` (×2) and `POST /v1/applicant-session/biometric-checks` (×1), polls each to a terminal status, and shows a generic "submitted" completion screen.

**It never computes or shows a pass/fail decision.** Decisioning (Phase 4) is a bank-triggered action requiring the tenant's own API key — there is no applicant-session route for it, on purpose. This widget's job ends at "documents and selfie successfully submitted"; the bank's own backend decides what to do with the result, out of band.

**Every capture step is camera-only. There is no file-upload fallback anywhere in the flow** — not for the two document steps, not for the selfie. If the browser denies camera permission or doesn't support `getUserMedia`, the only option shown is "Try again"; there is no alternate upload path to fall back to. This is a deliberate, explicit product decision, not an oversight or a missing feature — accepting a pre-existing file would defeat the point of a *live* capture for both the document authenticity check and the liveness check the selfie feeds into.

Capture itself is **manual** (tap-to-capture with a static framing-guide overlay), not real-time auto-detection — the user confirmed this choice twice. `CameraView` is structured so swapping the trigger mechanism later (e.g. to real-time edge detection via OpenCV.js) is a contained change — it just needs to eventually produce a `Blob`, regardless of what triggers that — but the CV work itself (WASM bundle size, tuning) is a separate, sizeable undertaking whenever it's tackled, not made any smaller by having deferred it.

## Usage

```html
<div id="capture-widget"></div>
<script src="https://your-lybid-instance.example/capture-sdk.js"></script>
<script>
  window.LybID.mount('#capture-widget', {
    sessionToken: '...',      // minted server-side via POST /v1/applicants/:id/session-token
                               // (requires your real API key — never call this from the browser)
    apiBaseUrl: 'https://your-lybid-instance.example',
    onComplete: () => { /* all three uploads reached a terminal status */ },
    onError: (err) => { /* something failed */ },
  });
</script>
```

`apiBaseUrl` is required-in-spirit, not hardcoded to one SaaS endpoint — this is a self-hosted platform (see Phase 9 in the root README), so a bank running its own LybID instance points the SDK at its own API.

`sessionToken` must be minted by the bank's own backend, server-to-server, using their real `X-API-Key` — the SDK itself never sees or needs that key. See the root README's "Applicant-Session Auth" section for the full auth model.

## Why Shadow DOM

The widget renders inside a Shadow DOM attached to the mount target, not directly into the host page's DOM. This isn't cosmetic — it's the actual mechanism that lets a bank drop this into an arbitrary existing page without a CSS collision in either direction: the bank's own page styles can't leak in and break the capture UI, and the widget's compiled Tailwind (injected as a `<style>` tag *inside* the shadow root, not the document `<head>`) can't leak out and break the bank's page. React + ReactDOM are bundled into the output, not peer dependencies — the host page can't be assumed to have React at all, so this is a genuinely self-contained drop-in script, at the cost of a larger bundle.

## Build

```bash
pnpm --filter @lybid/capture-sdk build   # -> dist/capture-sdk.js, a single IIFE, loadable via a bare <script> tag
pnpm --filter @lybid/capture-sdk test    # Vitest — state machine + component logic
pnpm --filter @lybid/capture-sdk lint
```

Vite library mode, `formats: ['iife']`, `name: 'LybID'` (→ `window.LybID`). `assetsInlineLimit` is forced to unlimited so the logo inlines as a data URI rather than emitting as a separate hashed file — the whole point is one script, no co-located assets a CDN might not preserve.

**A real bug this build setup hit, worth recording**: the first build produced a 796KB bundle that loaded fine over HTTP but left `window.LybID` `undefined` in a real browser — `vite build` and `tsc --noEmit` both passed cleanly, giving no indication anything was wrong. Found only by actually loading the compiled script via a real `<script>` tag in a real browser and catching the error: `ReferenceError: process is not defined`, thrown synchronously inside React/ReactDOM's own code (their `process.env.NODE_ENV` dev-mode checks) partway through the IIFE's top-level execution — which aborted the whole `var LybID = (function(){...})()` assignment before it completed, leaving the global unset with no build-time warning at all. Vite's library-mode build doesn't reliably strip `process.env.NODE_ENV` in bundled dependencies the way its app-mode build does; `vite.config.ts` now sets `define: { 'process.env.NODE_ENV': JSON.stringify('production') }` explicitly, which both fixes the crash and lets dead-code elimination drop React's entire dev-mode branch — the fixed bundle is 466KB, not 796KB. Left as documented reasoning in `vite.config.ts` itself, not just here — this is exactly the class of bug `vite build`'s own success output cannot catch, and it's why the plan's "load it in an actually separate page" verification step existed in the first place.

## Testing notes

`test/state-machine.test.ts` covers the step-sequencing reducer exhaustively (11 tests) — this is plain logic, no DOM needed. `test/Widget.test.tsx` covers the Welcome → capture-step transition and the camera-unsupported fallback message, and explicitly asserts there is no upload button and no `<input type="file">` anywhere in the DOM at that point (jsdom has no real camera, so `CameraView`'s actual video/canvas behavior isn't — and can't usefully be — exercised in this suite).

**Real end-to-end verification** (a genuinely separate origin, not a test inside this package's own tooling): `demo/index.html` was served from `localhost:8080` (a plain `python -m http.server`, nothing LybID-specific) against the real API on `localhost:3000`, using a real session token minted via the real `POST /v1/applicants/:id/session-token` route, in a real browser (Microsoft Edge, headless, with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`). Confirmed live, not assumed:
- The widget mounts, and the LybID logo + "Powered by Marsa" footer are actually visible.
- The demo page's deliberately clashing host CSS (dark serif body, red/lime `!important` buttons, wavy orange underline) does not bleed into the widget, and the widget's own Tailwind styling does not bleed out — Shadow DOM isolation holds in both directions, confirmed by screenshot, not just by using the API.
- Clicking through to the passport-capture screen renders the progress bar, framing guide, and instructions correctly, and `CameraView` correctly enters its `'requesting'` state (shows "Starting camera…", disabled Capture button) without crashing.
- Separately, via curl against the real running server (not assumed from reading the auth code): a real session token is rejected with `401` when used as an `X-API-Key`, when used against any admin route, and when used to try to mint another session token — confirming it's genuinely scoped to only the two applicant-session route groups it's meant for.

**A known, honest gap, not silently glossed over**: headless Edge's `--screenshot` flag takes exactly one screenshot after page load with no interactive driving, and the fake camera device did not visibly progress past `CameraView`'s `'requesting'` state within that single frame in this environment (neither a longer `--virtual-time-budget` nor `--headless=new` changed the result) — so the actual capture → review → next-step transition, and the full three-step submission → completion flow, have **not** been verified against a real live camera feed end-to-end in an automated run. `chromium-cli`/Playwright (which would allow real interactive clicking and waiting) are not installed in this environment and were judged not worth a ~200MB install given this project's repeated disk-space issues. The state-machine and per-screen logic covering that full sequence *is* unit-tested (`state-machine.test.ts`), but a genuine live-camera interactive run through the whole flow is still worth doing manually in a real browser before relying on this in production.

## Package layout

```
src/
  index.ts              # public API: mount(selector, config), unmount(selector)
  Widget.tsx             # top-level component, owns the step state machine
  lib/
    api-client.ts          # fetch wrapper for /v1/applicant-session/* only
    state-machine.ts       # step sequencing
  steps/                    # Welcome, DocumentCapture, ReviewCapture, Processing, Completion, ErrorScreen
  components/                # Header, Footer, Button, ProgressBar, CameraView
  assets/lybid-logo.png
  styles/index.css              # Tailwind directives, injected into the shadow root at mount time
test/                            # Vitest
demo/index.html                    # real script-tag usage, for manual smoke testing against a running API
```
