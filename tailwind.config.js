/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans Thai', 'system-ui', 'sans-serif'],
      },
      colors: {
        pitch: {
          950: '#050807',
          900: '#07110d',
          850: '#0b1712',
          800: '#10201a',
          700: '#172b23',
        },
        edge: {
          green: '#22c55e',
          gold: '#f6c445',
          red: '#ef4444',
          mist: '#c8d4cd',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,197,94,0.18), 0 18px 50px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
}
