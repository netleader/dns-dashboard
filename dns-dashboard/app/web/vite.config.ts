import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base: under Home Assistant ingress the app lives below /api/hassio_ingress/<token>/.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8099' },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
