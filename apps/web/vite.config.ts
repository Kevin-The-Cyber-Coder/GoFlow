import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Inside Docker the API lives on the `api` service, not on the host. Keeping the
// target configurable lets the same Vite config serve both setups.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  // The HTML entry lives alongside the app sources in `src`, so Vite treats
  // that directory as the project root. The production bundle still lands in
  // `apps/web/dist`, which is what the nginx image copies.
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
