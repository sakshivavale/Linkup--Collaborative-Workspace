import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'process.env.IS_PREACT': JSON.stringify('true'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@linkup/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Proxy all API and health requests to the backend server.
    // This means the browser NEVER makes cross-origin requests, so CORS
    // issues on the client side are permanently eliminated regardless of
    // which IP address the dev machine is on.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/execute': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/runtimes': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
