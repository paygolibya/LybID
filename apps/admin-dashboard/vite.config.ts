import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Normal Vite app build (not library/IIFE mode like capture-sdk — this is
// Marsa's own internal ops tool, served as its own site, not embedded in a
// bank's page). A distinct dev port from capture-sdk's default so both can
// run side by side during development.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
