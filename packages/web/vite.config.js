import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/timetable/',
  build: {
    outDir: 'dist',
  },
  server: {
    // Bind both IPv4 and IPv6 loopback interfaces.  On this machine Vite can
    // otherwise choose only ::1, while the in-app browser resolves localhost
    // to 127.0.0.1 and reports every API request as "Failed to fetch".
    host: '0.0.0.0',
    port: 3000,
    open: true,
    proxy: {
      // Match the API namespace boundary only. A plain `/api` prefix also
      // captures the frontend module `/api-state-revision.mjs`, causing the
      // backend SPA fallback to return HTML where the browser expects JS.
      '^/timetable/api(?:/|$)': {
        target: 'http://localhost:3001',
        // Keep the browser Host. changeOrigin rewrites it to localhost:3001,
        // which fails the backend Origin===Host check on POST (clear, save, solve).
        changeOrigin: false,
      },
      '^/api(?:/|$)': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
});
