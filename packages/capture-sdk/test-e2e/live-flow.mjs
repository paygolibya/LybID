#!/usr/bin/env node
// Real, interactive, real-camera verification of the capture flow —
// the gap the project's own README honestly flagged: earlier browser
// checks (a static Edge --screenshot) could prove the widget mounted and
// reached the passport-capture screen with a fake camera device, but
// never drove an actual click-through past that, because no
// interactive browser driver was available at the time. This script is
// that driver, added in a follow-up pass once Playwright was installed.
//
// NOT part of `pnpm test` — this needs a real running backend (API +
// real OCR/biometrics sidecars, not stubs) and a real session token, the
// same way demo/index.html is a manual verification tool, not an
// automated one. Run it by hand:
//
//   node test-e2e/live-flow.mjs <sessionToken> <apiBaseUrl> <demoUrl>
//
// e.g. node test-e2e/live-flow.mjs eyJhbGc... http://localhost:3000 http://localhost:8080/demo/index.html
//
// Requires: `pnpm exec playwright install chromium` once, and a static
// file server already serving this package's own root (so demoUrl's
// relative `../dist/capture-sdk.js` resolves) — see the root README's
// capture-sdk section for the exact commands used to set this up.

import { chromium } from 'playwright';

const [sessionToken, apiBaseUrl, demoUrl] = process.argv.slice(2);
if (!sessionToken || !apiBaseUrl || !demoUrl) {
  console.error(
    'Usage: node test-e2e/live-flow.mjs <sessionToken> <apiBaseUrl> <demoUrl>',
  );
  process.exit(1);
}

const SHOT_DIR = process.env.SHOT_DIR ?? '.';
let shotIndex = 0;
async function shot(page, name) {
  shotIndex += 1;
  const path = `${SHOT_DIR}/live-flow-${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path });
  console.log(`  screenshot: ${path}`);
}

/** Polls document.querySelector('video').videoWidth inside the SDK's
 * Shadow DOM until frames are actually flowing — the Capture button
 * becomes enabled as soon as getUserMedia() resolves and .play() is
 * called, which can be a moment before the fake device's first frame is
 * actually decoded. Clicking Capture before that is a silent no-op (see
 * CameraView.tsx's capture(): it returns early if videoWidth === 0),
 * which would otherwise leave this script stuck waiting for a review
 * screen that never appears. */
async function waitForVideoFrame(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('#capture-widget > div');
    const video = host?.shadowRoot?.querySelector('video');
    return !!video && video.videoWidth > 0;
  }, { timeout: 15000 });
}

async function clickInShadow(page, text) {
  const handle = await page.waitForFunction(
    (label) => {
      const host = document.querySelector('#capture-widget > div');
      const root = host?.shadowRoot;
      const btn = root
        ? [...root.querySelectorAll('button')].find((b) =>
            b.textContent?.toLowerCase().includes(label.toLowerCase()),
          )
        : null;
      return btn && !btn.disabled ? btn : null;
    },
    text,
    { timeout: 20000 },
  );
  await handle.evaluate((btn) => btn.click());
}

async function shadowTextVisible(page, text, timeout = 20000) {
  return page.waitForFunction(
    (label) => {
      const host = document.querySelector('#capture-widget > div');
      return !!host?.shadowRoot?.textContent?.includes(label);
    },
    text,
    { timeout },
  );
}

async function main() {
  console.log('Launching headless Chromium with a fake camera device...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  const context = await browser.newContext();
  await context.grantPermissions(['camera']);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const url = `${demoUrl}?token=${encodeURIComponent(sessionToken)}&api=${encodeURIComponent(apiBaseUrl)}`;
  console.log(`Navigating to ${url}`);
  await page.goto(url);

  await shadowTextVisible(page, "Let's verify your identity");
  await shot(page, 'welcome');
  console.log('Welcome screen confirmed. Clicking Get started...');
  await clickInShadow(page, 'Get started');

  const steps = [
    { label: 'passport', title: 'Scan your passport' },
    { label: 'birth-certificate', title: 'Scan your birth certificate' },
    { label: 'selfie', title: 'Take a selfie' },
  ];

  for (const step of steps) {
    await shadowTextVisible(page, step.title);
    console.log(`${step.title} screen confirmed. Waiting for a real camera frame...`);
    await waitForVideoFrame(page);
    await shot(page, `${step.label}-camera-ready`);
    await clickInShadow(page, 'Capture');
    console.log('Captured. Waiting for the review screen...');
    await shadowTextVisible(page, 'Looks good');
    await shot(page, `${step.label}-review`);
    await clickInShadow(page, 'Looks good');
    console.log(`${step.label} confirmed.`);
  }

  console.log('All three captures submitted. Waiting for processing to finish...');
  await shot(page, 'processing');
  // Real OCR + real biometrics, not stubs — genuinely can take a while.
  await shadowTextVisible(page, 'Submitted', 60000);
  await shot(page, 'completion');
  console.log('Reached the Submitted / completion screen.');

  if (consoleErrors.length > 0) {
    console.error('\nConsole/page errors observed during the run:');
    for (const e of consoleErrors) console.error(`  - ${e}`);
    await browser.close();
    process.exit(1);
  }

  console.log('\nNo console errors. Live capture flow verified end-to-end.');
  await browser.close();
}

main().catch(async (err) => {
  console.error('Live flow script failed:', err);
  process.exit(1);
});
