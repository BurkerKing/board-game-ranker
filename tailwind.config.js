/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        paper: '#f7f2e8',
        ink: '#25231f',
        moss: '#63755b',
        clay: '#a85f3f',
        linen: '#fffaf0',
      },
      boxShadow: {
        soft: '0 12px 32px rgba(37, 35, 31, 0.09)',
      },
    },
  },
  plugins: [],
}
