import type { Config } from 'tailwindcss';

// Every semantic color below reads from a CSS custom property (see
// src/index.css's :root / .dark blocks) instead of a literal hex, so dark
// mode is a matter of swapping the variables' values — every component
// already built against these tokens (bg-surface, text-text-2, border-border,
// etc.) gets it for free, no per-component dark: variant needed. Vars are
// stored as space-separated "r g b" triples (not hex) so Tailwind's opacity
// modifiers (bg-primary/30, ring-primary/30) still work via rgb(var(...) / a).
function withOpacity(varName: string) {
  return `rgb(var(${varName}) / <alpha-value>)`;
}

export default {
  darkMode: 'class',
  content: ['./crm/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: withOpacity('--color-bg'),
        surface: { DEFAULT: withOpacity('--color-surface'), 2: withOpacity('--color-surface-2'), 3: withOpacity('--color-surface-3') },
        border: { DEFAULT: withOpacity('--color-border'), 2: withOpacity('--color-border-2') },
        text: { DEFAULT: withOpacity('--color-text'), 2: withOpacity('--color-text-2'), 3: withOpacity('--color-text-3') },
        // Brand sky-deep — Bluebird's own "logo bird blue," not a generic indigo.
        primary: {
          DEFAULT: withOpacity('--color-primary'),
          dim: withOpacity('--color-primary-dim'),
          hover: withOpacity('--color-primary-hover'),
          text: withOpacity('--color-primary-text'),
        },
        // Brand brass — "closing-table accent: trust, cost-covered." Used
        // sparingly (premium emphasis, the Closed pipeline stage), never as
        // a primary action color.
        accent: { DEFAULT: withOpacity('--color-accent'), dim: withOpacity('--color-accent-dim'), hover: withOpacity('--color-accent-hover') },
        info: { DEFAULT: withOpacity('--color-info'), dim: withOpacity('--color-info-dim'), text: withOpacity('--color-info-text') },
        success: { DEFAULT: withOpacity('--color-success'), dim: withOpacity('--color-success-dim') },
        warning: { DEFAULT: withOpacity('--color-warning'), dim: withOpacity('--color-warning-dim') },
        danger: { DEFAULT: withOpacity('--color-danger'), dim: withOpacity('--color-danger-dim') },
        // Brand navy — same shell the marketing site uses for its header.
        // Deliberately NOT theme-driven — it's already dark, so it reads
        // correctly as the same brand shell in both light and dark mode.
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
        lg: '22px',
        md: '12px',
        xl: '26px',
      },
      boxShadow: {
        // Softer, deeper "floating" card shadow — the premium-SaaS pass
        // traded the old tight/flat shadow for more spread and less
        // opacity, so cards read as lifted rather than merely outlined.
        card: '0 2px 4px 0 rgba(11, 30, 51, 0.03), 0 14px 32px -16px rgba(11, 30, 51, 0.14)',
        'card-hover': '0 4px 8px 0 rgba(11, 30, 51, 0.05), 0 20px 40px -16px rgba(11, 30, 51, 0.18)',
        popover: '0 10px 15px -3px rgba(11, 30, 51, 0.10), 0 4px 6px -4px rgba(11, 30, 51, 0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
