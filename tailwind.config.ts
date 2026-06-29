import type { Config } from 'tailwindcss';

export default {
  content: ['./crm/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f8fafc',
        surface: { DEFAULT: '#ffffff', 2: '#f8fafc', 3: '#f1f5f9' },
        border: { DEFAULT: '#e2e8f0', 2: '#cbd5e1' },
        text: { DEFAULT: '#0f172a', 2: '#475569', 3: '#94a3b8' },
        primary: { DEFAULT: '#4f46e5', dim: '#eef2ff', hover: '#4338ca', text: '#4338ca' },
        info: { DEFAULT: '#0ea5e9', dim: '#f0f9ff', text: '#0369a1' },
        success: { DEFAULT: '#10b981', dim: '#ecfdf5' },
        warning: { DEFAULT: '#f59e0b', dim: '#fffbeb' },
        danger: { DEFAULT: '#ef4444', dim: '#fef2f2' },
        sidebar: { DEFAULT: '#0f172a', 2: '#1e293b', border: '#1e293b', text: '#94a3b8', textActive: '#ffffff' },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        lg: '12px',
        md: '8px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)',
        popover: '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.05)',
      },
    },
  },
  plugins: [],
} satisfies Config;
