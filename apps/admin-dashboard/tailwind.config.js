/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Same brand palette as @lybid/capture-sdk, for visual consistency
      // between the two frontends this project has now.
      colors: {
        brand: {
          DEFAULT: '#0EA5B7',
          dark: '#0B1220',
        },
      },
    },
  },
  plugins: [],
};
