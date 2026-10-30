import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the editor runs on Vite's server and reaches a development daemon through this proxy
// (see scripts/dev.sh). Built, it is served by the daemon itself.
const daemon = `127.0.0.1:${process.env.NIB_PORT ?? 7461}`;

export default defineConfig({
  plugins: [react()],
  define: { __NIB_DEV_TOKEN__: JSON.stringify(process.env.NIB_TOKEN ?? '') },
  server: {
    port: Number(process.env.EDITOR_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: `http://${daemon}`, changeOrigin: true },
      '/ws': { target: `ws://${daemon}`, ws: true, changeOrigin: true },
    },
  },
  build: { target: 'es2023', chunkSizeWarningLimit: 4096 },
});
