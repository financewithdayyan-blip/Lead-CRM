const PREFIX = 'bbcrm:notif_read';

function storageKey(userId: string, dateIso: string) {
  return `${PREFIX}:${userId}:${dateIso}`;
}

export function loadReadIds(userId: string, dateIso: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(userId, dateIso));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function saveReadIds(userId: string, dateIso: string, ids: Set<string>) {
  try {
    localStorage.setItem(storageKey(userId, dateIso), JSON.stringify([...ids]));
  } catch {
    // ignore unavailable/full storage
  }
}
