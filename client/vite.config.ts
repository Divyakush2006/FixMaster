import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The app calls the API at the same-origin path /api (see src/api/client.ts).
// In development Vite forwards it to the backend; in production nginx does
// (client/nginx.conf). Override the target with API_PROXY_TARGET.
const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    port: 3000,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Third-party code changes far less often than app code; separate
        // chunks let browsers keep them cached across app deploys.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});
