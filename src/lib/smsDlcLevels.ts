/**
 * 10DLC numbers start heavily throttled by carriers and gain daily-send
 * throughput gradually as the number's trust score/vetting matures — this
 * table mirrors that real-world progression instead of an admin typing a
 * guessed flat daily number. A number's level only climbs one step at a
 * time (see SmsNumberLevelsCard's "unlock next level"), matching how
 * carrier throughput actually increases over time rather than jumping.
 */
export const SMS_DLC_LEVEL_DAILY_LIMITS: Record<number, number> = {
  1: 200,
  2: 350,
  3: 500,
  4: 700,
  5: 950,
  6: 1250,
  7: 1600,
  8: 2000,
  9: 2450,
  10: 3000,
};

export const SMS_DLC_LEVELS = Object.keys(SMS_DLC_LEVEL_DAILY_LIMITS)
  .map(Number)
  .sort((a, b) => a - b);

export const SMS_DLC_MAX_LEVEL = SMS_DLC_LEVELS[SMS_DLC_LEVELS.length - 1];
