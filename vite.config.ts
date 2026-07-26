import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Dev-server equivalent of the /crm/* -> /crm/index.html rewrite in vercel.json /
// netlify.toml, so refreshing on a deep CRM route (e.g. /crm/leads/123) works
// locally too, not just in production.
function crmSpaFallback(): Plugin {
  return {
    name: 'crm-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/crm') && !req.url.includes('.')) {
          req.url = '/crm/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), crmSpaFallback()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        crm: path.resolve(__dirname, 'crm/index.html'),
      },
      output: {
        // Split the 476KB entry chunk so the browser downloads vendors in
        // parallel, and so they stay cached across deploys instead of being
        // re-fetched every time app code changes.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-virtual': ['@tanstack/react-virtual'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 5173,
  },
});
