import type { Config } from 'tailwindcss';

export default {
  content: ['./crm/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f8fafc',
        surface: { DEFAULT: '#ffffff', 2: '#f8fafc', 3: '#f1f5f9' },
        border: { DEFAULT: '#e2e8f0', 2: '#cbd5e1' },
        text: { DEFAULT: '#0B1E33', 2: '#45566B', 3: '#8693A1' },
        // Brand sky-deep — Bluebird's own "logo bird blue," not a generic indigo.
        primary: { DEFAULT: '#1568A8', dim: '#eaf3fb', hover: '#0e4a7a', text: '#0e4a7a' },
        // Brand brass — "closing-table accent: trust, cost-covered." Used
        // sparingly (premium emphasis, the Closed pipeline stage), never as
        // a primary action color.
        accent: { DEFAULT: '#C9A24B', dim: '#faf5e8', hover: '#b3893a' },
        info: { DEFAULT: '#0891b2', dim: '#f0fdff', text: '#0e7490' },
        success: { DEFAULT: '#10b981', dim: '#ecfdf5' },
        warning: { DEFAULT: '#f59e0b', dim: '#fffbeb' },
        danger: { DEFAULT: '#ef4444', dim: '#fef2f2' },
        // Brand navy — same shell the marketing site uses for its header.
        sidebar: { DEFAULT: '#0B1E33', 2: '#132A45', border: '#132A45', text: '#8CA0B8', textActive: '#ffffff' },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        // Page-level <h1> titles only — real brand character at the top of
        // each page without touching dense UI/data text.
        serif: ['Fraunces', 'Georgia', 'serif'],
        // Big stat numbers / currency values — aligned tabular numerals,
        // the "premium data tool" look.
        mono: ['JetBrains Mono', 'SF Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '10px',
        md: '8px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(11, 30, 51, 0.04), 0 2px 8px 0 rgba(11, 30, 51, 0.06)',
        'card-hover': '0 2px 4px 0 rgba(11, 30, 51, 0.06), 0 6px 16px 0 rgba(11, 30, 51, 0.09)',
        popover: '0 10px 15px -3px rgba(11, 30, 51, 0.10), 0 4px 6px -4px rgba(11, 30, 51, 0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
