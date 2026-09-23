/**
 * 10DLC numbers start heavily throttled by carriers and gain daily-send
 * throughput gradually as the number's trust score/vetting matures — this
 * table mirrors that real-world progression instead of an admin typing a
 * guessed flat daily number. Fully automatic now (see auto_promote_sms_
 * levels, 0154/0156) — nothing in the UI sets this by hand.
 *
 * Mirrored in SQL by sms_dlc_level_limit() — keep both in sync if this
 * table ever changes.
 */
export const SMS_DLC_LEVEL_DAILY_LIMITS: Record<number, number> = {
  1: 250,
  2: 500,
  3: 750,
  4: 1000,
  5: 1300,
  6: 1600,
  7: 2000,
  8: 2500,
  9: 3000,
  10: 3500,
  11: 4000,
  12: 5000,
};

export const SMS_DLC_LEVELS = Object.keys(SMS_DLC_LEVEL_DAILY_LIMITS)
  .map(Number)
  .sort((a, b) => a - b);

export const SMS_DLC_MAX_LEVEL = SMS_DLC_LEVELS[SMS_DLC_LEVELS.length - 1];
