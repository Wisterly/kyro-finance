/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        kyro: {
          dark: '#0B0F19',
          card: '#111827',
          cardBorder: '#1F293D',
          gold: '#D97706',
          goldLight: '#FBBF24',
          accent: '#F59E0B',
          glow: 'rgba(217, 119, 6, 0.15)',
        }
      }
    },
  },
  plugins: [],
}
