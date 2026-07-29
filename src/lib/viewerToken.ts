const TOKEN_KEY = 'bb_packet_viewer_token';

/**
 * Stable per-browser identity for an anonymous packet viewer. It is what
 * "unique view" counts against and what an approved address request is keyed
 * to, so clearing site data legitimately reads as a new viewer.
 */
export function getViewerToken(): string {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

/** Name/email captured by the lead-capture gate, remembered per packet. */
export interface ViewerIdentity {
  name: string;
  email: string;
  phone?: string;
}

export function getViewerIdentity(slug: string): ViewerIdentity | null {
  const raw = localStorage.getItem(`bb_packet_identity_${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ViewerIdentity;
  } catch {
    return null;
  }
}

export function saveViewerIdentity(slug: string, identity: ViewerIdentity) {
  localStorage.setItem(`bb_packet_identity_${slug}`, JSON.stringify(identity));
}
