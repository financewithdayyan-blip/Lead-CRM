import { Component, type ReactNode } from 'react';

const RELOAD_FLAG = 'bb_chunk_reload_attempted';

/** Vite gives every JS chunk a content hash in its filename — a new deploy
 * ships entirely new hashed files rather than overwriting old ones. A tab
 * (or a link opened days later) that still has the old index.html cached
 * asks for a chunk hash that no longer exists on the server, and that
 * `import()` rejects. This is the single most common cause of an uncaught
 * error in a Vite SPA with no code changes involved at all. */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|loading chunk|importing a module script failed/i.test(message);
}

interface State {
  hasError: boolean;
}

/**
 * React's default behavior for an uncaught render error with no boundary
 * anywhere in the tree is to unmount the entire app — a totally blank page,
 * no message, nothing recoverable, and (since nothing ever reaches our
 * servers) no trace in any audit log either. A signer opening a link they
 * were sent before we last deployed is the most common way to hit this; this
 * boundary catches it, auto-reloads once for a stale-chunk error (which
 * picks up the new build and just works), and shows a real recovery screen
 * with a reload button for anything else instead of nothing at all.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (!isChunkLoadError(error)) return;
    try {
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch {
      // Private browsing / storage blocked — reload once anyway, just
      // without the loop guard.
    }
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            textAlign: 'center',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            background: '#f8fafc',
          }}
        >
          <div>
            <p style={{ fontSize: 17, fontWeight: 600, color: '#0B1E33', margin: 0 }}>Something went wrong loading this page</p>
            <p style={{ marginTop: 6, fontSize: 13.5, color: '#64748b', maxWidth: 360 }}>
              Try reloading — if it keeps happening, reach out to whoever sent you this link.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: '10px 20px',
                borderRadius: 8,
                background: '#0B1E33',
                color: 'white',
                border: 'none',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
