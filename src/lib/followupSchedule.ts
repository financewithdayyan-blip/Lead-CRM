// Touch schedule: day numbers (1 = followup start day) when a touch is due
export const TOUCH_SCHEDULE_DAYS = [1, 2, 3, 6, 7, 8, 11, 12, 16, 17] as const;
const TOUCH_SCHEDULE_SET = new Set<number>(TOUCH_SCHEDULE_DAYS);

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 1-indexed day count from the followup start date
export function followupDayNumber(startDate: string, today: string): number {
  const diffMs = parseDate(today).getTime() - parseDate(startDate).getTime();
  return Math.round(diffMs / 86400000) + 1;
}

// Whether today is a scheduled touch day for this lead
export function isTouchScheduledToday(startDate: string | null, today: string): boolean {
  if (!startDate) return false;
  return TOUCH_SCHEDULE_SET.has(followupDayNumber(startDate, today));
}

// Whether today has already been logged as a touch
export function isTouchedToday(touchDates: string[], today: string): boolean {
  return touchDates.includes(today);
}

// The next scheduled touch date at or after today (null when all 10 are past)
export function nextScheduledTouchDate(startDate: string | null, touchCount: number, today: string): string | null {
  if (!startDate || touchCount >= 10) return null;
  const start = parseDate(startDate);
  for (let i = touchCount; i < TOUCH_SCHEDULE_DAYS.length; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + TOUCH_SCHEDULE_DAYS[i] - 1);
    const iso = toIso(d);
    if (iso >= today) return iso;
  }
  return null;
}

// Whether the lead has passed day 17 without completing all 10 touches
export function isFollowupOverdue(startDate: string | null, touchCount: number, today: string): boolean {
  if (!startDate || touchCount >= 10) return false;
  return followupDayNumber(startDate, today) > 17;
}

/**
 * Auction-aware touch-due check for followup-stage leads.
 * Respects the three touch schedule modes driven by days to auction:
 *   standard  → uses the fixed [1,2,3,6,7,8,11,12,16,17] schedule
 *   daily     → every day (10–16 days to auction), still needs ≤ 10 touches
 *   deadline  → every day (<10 days), 10-touch minimum waived
 *
 * Returns true when a touch is due today and hasn't been logged yet.
 */
export function isTouchDueTodayAuctionAware(
  touchDates: string[],
  followupStartDate: string | null,
  touchCount: number,
  daysToAuction: number | null,
  today: string,
): boolean {
  if (isTouchedToday(touchDates, today)) return false;
  // deadline: call every day until auction regardless of touch count
  if (daysToAuction !== null && daysToAuction < 10) return true;
  if (touchCount >= 10) return false;
  // daily: no gap days when 10–16 days out
  if (daysToAuction !== null && daysToAuction <= 16) return true;
  // standard: use fixed schedule
  return isTouchScheduledToday(followupStartDate, today);
}

// "Jul 9" display format
export function formatTouchDate(iso: string): string {
  const d = parseDate(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
