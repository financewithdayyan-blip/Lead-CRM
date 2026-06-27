import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Dev-server equivalent of the /app/* -> /app/index.html rewrite in vercel.json /
// netlify.toml, so refreshing on a deep CRM route (e.g. /app/leads/123) works
// locally too, not just in production.
function appSpaFallback(): Plugin {
  return {
    name: 'app-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/app') && !req.url.includes('.')) {
          req.url = '/app/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), appSpaFallback()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        app: path.resolve(__dirname, 'app/index.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
