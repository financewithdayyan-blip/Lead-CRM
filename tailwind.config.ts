import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0c0e14',
        surface: { DEFAULT: '#13161f', 2: '#191d29', 3: '#1f2433', 4: '#252b3b' },
        border: { DEFAULT: '#232838', 2: '#2a3042', 3: '#343c52' },
        text: { DEFAULT: '#eef0f5', 2: '#a6acc1', 3: '#6b7184' },
        blue: { DEFAULT: '#00cfb4', dim: 'rgba(0,207,180,0.12)', bright: '#2ddfc8' },
        green: { DEFAULT: '#22c97b', dim: 'rgba(34,201,123,0.11)' },
        red: { DEFAULT: '#f05252', dim: 'rgba(240,82,82,0.11)' },
        purple: { DEFAULT: '#b08afa', dim: 'rgba(176,138,250,0.12)' },
        orange: { DEFAULT: '#ff8c4b', dim: 'rgba(255,140,75,0.12)' },
        amber: { DEFAULT: '#f5a524', dim: 'rgba(245,165,36,0.12)' },
      },
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
        display: ['Syne', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        lg: '14px',
        md: '10px',
      },
    },
  },
  plugins: [],
} satisfies Config;
