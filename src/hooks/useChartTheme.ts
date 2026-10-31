import { useTheme } from '@/contexts/ThemeContext';

/**
 * recharts takes plain color strings on SVG props (stroke, fill, tooltip
 * `contentStyle`) — those don't resolve CSS custom properties the way
 * Tailwind classes do, so every chart's neutral "chrome" (axis lines, grid,
 * tooltip background) needs its own light/dark pair here. The colored data
 * series themselves (line strokes, bar fills) stay constant hex — those are
 * saturated enough to read fine against either background and don't need a
 * per-theme swap. Values mirror the CSS vars in src/index.css.
 */
export function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return {
    // Dark values match the Tristate Ledger palette (src/index.css's .dark
    // block) — kept as literal hex here since recharts style props don't
    // resolve CSS custom properties.
    axisStroke: dark ? '#7D8597' : '#8693A1',
    gridStroke: dark ? '#1C2030' : '#e2e8f0',
    tooltipBg: dark ? '#151925' : '#ffffff',
    tooltipBorder: dark ? '#262C40' : '#e2e8f0',
    textFill: dark ? '#F2F4F8' : '#0B1E33',
  };
}
