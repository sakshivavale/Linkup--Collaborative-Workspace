// @type {import('tailwindcss').Config}
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary palette (light theme)
        primary: {
          50: '#EFF6FF',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#2563EB', // primary blue
          600: '#1D4ED8', // deep blue (hover)
          700: '#1E40AF',
          800: '#1E3A8A',
          900: '#172554',
        },
        sky: {
          500: '#38BDF8',
        },
        light: {
          500: '#EFF6FF',
        },
        purple: {
          500: '#8B5CF6',
        },
        teal: {
          500: '#14B8A6',
        },
        background: {
          DEFAULT: '#F8FAFC',
        },
        card: {
          DEFAULT: '#FFFFFF',
        },
        inputBg: {
          DEFAULT: '#F0F9FF',
        },
        inputBorder: {
          DEFAULT: '#BFDBFE',
        },
        text: {
          primary: '#172554',
          secondary: '#64748B',
        },
        border: {
          DEFAULT: '#E2E8F0',
        },
        // Preserve existing dark theme colors
        dark: {
          bg: '#090d16',
          card: '#0f172a',
          cardHover: '#131d35',
          border: 'rgba(255, 255, 255, 0.08)',
          borderFocus: 'rgba(99, 102, 241, 0.5)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-indigo': '0 0 25px -5px rgba(99, 102, 241, 0.35)',
        'glow-purple': '0 0 25px -5px rgba(168, 85, 247, 0.35)',
      },
    },
  },
  plugins: [],
};
