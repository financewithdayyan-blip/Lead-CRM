/** UTC 14:00-01:00 is the 7pm-6am PKT cold-outreach window (see send-sms).
 * No bulk sends at all on the window that starts Sunday 7pm PKT (through
 * Monday 6am PKT) — mirrors send-sms's own withinSendWindow exactly, so
 * nothing here ever disagrees with what the backend will actually accept. */
export function withinSendWindow(): boolean {
  const now = new Date();
  const h = now.getUTCHours();
  const inWindow = h >= 14 || h < 1;
  if (!inWindow) return false;
  const windowStartDate = new Date(now);
  if (h < 1) windowStartDate.setUTCDate(windowStartDate.getUTCDate() - 1);
  return windowStartDate.getUTCDay() !== 0; // 0 = Sunday
}

/** Minutes until the next window that will actually be open — skips right
 * past a Sunday-starting window (always rejected) to Monday's instead of
 * counting down to an opening that would just get rejected too. */
export function nextSendWindowOpensIn(): string {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const minutesNow = utcH * 60 + utcM;
  const opensAt = 14 * 60; // 14:00 UTC
  let diff = opensAt - minutesNow;
  let daysAhead = 0;
  if (diff <= 0) {
    diff += 24 * 60;
    daysAhead = 1;
  }
  const windowStartDate = new Date(now);
  windowStartDate.setUTCDate(windowStartDate.getUTCDate() + daysAhead);
  if (windowStartDate.getUTCDay() === 0) diff += 24 * 60; // push past Sunday's closed window
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}h ${m}m`;
}

/** True specifically when it's the hour-of-day the window would normally be
 * open, but it's closed anyway because this is Sunday's window — lets a
 * banner say *why* instead of just a countdown that doesn't explain itself. */
export function closedForSundaySendWindow(): boolean {
  const now = new Date();
  const h = now.getUTCHours();
  if (!(h >= 14 || h < 1)) return false; // wrong hour entirely, not a Sunday-specific closure
  const windowStartDate = new Date(now);
  if (h < 1) windowStartDate.setUTCDate(windowStartDate.getUTCDate() - 1);
  return windowStartDate.getUTCDay() === 0;
}
