import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
