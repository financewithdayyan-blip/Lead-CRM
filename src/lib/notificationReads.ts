const PREFIX = 'bbcrm:notif_read';

function storageKey(userId: string) {
  return `${PREFIX}:${userId}`;
}

/**
 * Persists permanently per user — NOT scoped by date. It used to be keyed by
 * today's date, which meant the storage key itself changed every single day,
 * silently wiping every read mark and making the whole notification feed
 * (not just follow-ups) look unread again each morning. IDs that genuinely
 * need to re-notify when something changes (a rescheduled follow-up or task
 * due date) encode that value into the id itself now — see
 * NotificationsContext's `allIds` — rather than relying on the storage
 * resetting.
 */
export function loadReadIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function saveReadIds(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify([...ids]));
  } catch {
    // ignore unavailable/full storage
  }
}
