/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Phones in landscape and short phones (iPhone SE, Safari with its bars):
      // the game screen tightens so the cards and Buzz stay above the fold.
      screens: { short: { raw: "(max-height: 760px)" } },
      // "Paper" palette. Ink on warm paper, one highlight, two semantic colours.
      // Every text pairing here clears WCAG AA (4.5:1) on both paper and card.
      colors: {
        paper: '#f7f5f0',
        card: '#ffffff',
        ink: '#121212',
        muted: '#5c5a55',
        line: '#d9d4c8',
        tile: '#e9e5dc',
        mark: '#f2c94c',
        good: '#1d6b34',
        bad: '#b3261e',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
        'buzz-flash': {
          '0%, 50%': { opacity: '1' },
          '25%, 75%': { opacity: '0.25' },
          '100%': { opacity: '0' },
        },
        pop: {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        shake: 'shake 0.35s ease-in-out',
        pop: 'pop 0.16s ease-out',
        'buzz-flash': 'buzz-flash 1.2s ease-out forwards',
      },
    },
  },
  plugins: [],
};
