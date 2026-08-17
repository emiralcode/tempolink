/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#b3ccff',
          300: '#80a8ff',
          400: '#4d7cff',
          500: '#2657f5',
          600: '#1a3fd1',
          700: '#1731a3',
          800: '#182c7d',
          900: '#182a65',
        },
      },
      keyframes: {
        'alarm-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.55)' },
          '50%': { boxShadow: '0 0 0 12px rgba(239,68,68,0)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'alarm-pulse': 'alarm-pulse 1.4s ease-out infinite',
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
