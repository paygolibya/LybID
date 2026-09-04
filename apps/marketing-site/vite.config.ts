import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The public marketing site — distinct dev port from capture-sdk (5173
// default) and admin-dashboard (5174) so all three can run side by side.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
});
