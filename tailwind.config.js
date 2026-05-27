/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        paper: '#f8f1df',
        ink: '#25231f',
        moss: '#58785d',
        clay: '#b45d3f',
        linen: '#fffaf0',
        saffron: '#e0a82e',
        berry: '#8f3d5f',
        lagoon: '#287f8f',
        mint: '#dfead7',
        blush: '#f4d8cf',
      },
      boxShadow: {
        soft: '0 12px 32px rgba(37, 35, 31, 0.09)',
        lift: '0 16px 36px rgba(72, 52, 31, 0.16)',
      },
    },
  },
  plugins: [],
}
