import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // The React dev server talks to the Express backend through /api.
      // Backend default port is 3001; override with BACKEND_PORT if that port
      // is occupied (e.g. a stale dev server that won't free it).
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
});
