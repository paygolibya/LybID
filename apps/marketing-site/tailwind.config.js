/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Deliberately its own palette, not @lybid/admin-dashboard's
      // brand.DEFAULT teal — this is the public-facing identity approved
      // for the marketing site specifically (see the root README's
      // marketing-site section for the note on reconciling the two).
      colors: {
        ink: { DEFAULT: '#14170F', 2: '#1C2016', 3: '#262B1D' },
        paper: { DEFAULT: '#F6F2E9', 2: '#ECE5D3', 3: '#E2D9C2' },
        verified: { DEFAULT: '#0E6B4A', deep: '#0A4F37' },
        gold: { DEFAULT: '#D6A94A', deep: '#B98F36' },
      },
      fontFamily: {
        // English
        display: ['Fraunces', 'Georgia', 'serif'],
        body: ['"IBM Plex Sans"', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        // Arabic — Amiri for headlines (an elegant Naskh serif, the kind
        // of typeface an official Libyan document would actually use),
        // IBM Plex Sans Arabic for body (keeps the same family as the
        // English body face, just its Arabic cut).
        'display-ar': ['Amiri', 'Georgia', 'serif'],
        'body-ar': ['"IBM Plex Sans Arabic"', 'Tahoma', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
