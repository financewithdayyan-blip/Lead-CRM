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
        // Tightened from 22/12/26px — maximally-rounded corners plus a
        // soft floating shadow (see the old boxShadow.card comment below)
        // is the exact shadcn/ui-template default that's now everywhere;
        // a tighter, more rectangular radius reads as engineered rather
        // than generated.
        lg: '10px',
        md: '8px',
        xl: '14px',
      },
      boxShadow: {
        // Replaces a wide, soft "floating" glow (0 14px 32px, spread deep
        // enough that every card looked like it was hovering an inch off
        // the page) with a crisp, close elevation — definition comes from
        // the 1px border first, the shadow is just a faint lift, not the
        // card's main visual signature.
        card: '0 1px 2px 0 rgba(11, 30, 51, 0.04)',
        'card-hover': '0 2px 6px 0 rgba(11, 30, 51, 0.08)',
        popover: '0 8px 20px -6px rgba(11, 30, 51, 0.16)',
      },
    },
  },
  plugins: [],
} satisfies Config;
