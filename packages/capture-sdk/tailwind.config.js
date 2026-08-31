/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  // No `darkMode`/host-page-driven theming for v1 — the widget renders in
  // an isolated Shadow DOM (see index.ts), so it deliberately does not
  // inherit or react to the host page's own light/dark mode.
  theme: {
    extend: {
      colors: {
        // Loosely matched to the logo's palette (dark navy text, cyan
        // accent) — a clean, light, trustworthy KYC-flow look, not the
        // logo's own glitch/neon treatment applied to the whole UI.
        brand: {
          DEFAULT: '#0EA5B7',
          dark: '#0B1220',
        },
      },
    },
  },
  plugins: [],
};
