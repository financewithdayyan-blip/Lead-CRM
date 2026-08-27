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
    axisStroke: dark ? '#8090a6' : '#8693A1',
    gridStroke: dark ? '#24334a' : '#e2e8f0',
    tooltipBg: dark ? '#111d2e' : '#ffffff',
    tooltipBorder: dark ? '#24334a' : '#e2e8f0',
    textFill: dark ? '#eef2f7' : '#0B1E33',
  };
}
