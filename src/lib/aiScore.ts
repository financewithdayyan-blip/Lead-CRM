/** Shared score → color/label bands for the AI Lead Score, used on both the
 *  Lead Profile's AI Score card and the Kanban board's score badge/spotlight
 *  so the two stay visually consistent. */
export function scoreColor(score: number) {
  if (score >= 85) return { ring: 'ring-emerald-500', bg: 'bg-emerald-500', text: 'text-emerald-400', label: 'High' };
  if (score >= 65) return { ring: 'ring-blue-500', bg: 'bg-blue-500', text: 'text-blue-400', label: 'Good' };
  if (score >= 45) return { ring: 'ring-amber-500', bg: 'bg-amber-500', text: 'text-amber-400', label: 'Moderate' };
  if (score >= 25) return { ring: 'ring-orange-500', bg: 'bg-orange-500', text: 'text-orange-400', label: 'Low' };
  return { ring: 'ring-red-500', bg: 'bg-red-500', text: 'text-red-400', label: 'Dead' };
}
