import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// Library mode, IIFE output — loadable via a bare <script> tag with no
// bundler on the integrating bank's side (the whole point of "embeddable
// script" delivery, see the plan). `name: 'LybID'` is what ends up on
// `window.LybID`. React/ReactDOM are bundled in, not externalized — the
// host page can't be assumed to have React at all.
export default defineConfig({
  plugins: [react()],
  // React/ReactDOM's own source reads `process.env.NODE_ENV` at module-eval
  // time (dev-mode warnings, etc.). Vite's automatic define only covers this
  // reliably for app builds; in this IIFE library build it was leaking
  // through unreplaced, and since there's no Node `process` global in a
  // browser <script> tag, evaluating it threw `ReferenceError: process is
  // not defined` synchronously during the bundle's own top-level execution
  // — which aborted the IIFE before `var LybID = ...` ever got assigned,
  // leaving `window.LybID` undefined with no build-time warning. Replacing
  // it explicitly at build time removes the runtime reference entirely.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LybID',
      formats: ['iife'],
      fileName: () => 'capture-sdk.js',
    },
    // A single self-contained file, including CSS injected at runtime by
    // index.ts (see its own comment) rather than a separate stylesheet the
    // integrator would otherwise need to remember to <link>.
    cssCodeSplit: false,
    outDir: 'dist',
    // Vite's default 4KB inline threshold would emit the logo (~220KB) as
    // a separate hashed asset file — breaking "single script tag, no
    // co-located files required" the moment this is served from a CDN
    // that doesn't preserve relative paths. Force every asset to inline
    // as a data URI instead, whatever the size.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
});
