import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * US-SEC-02: Secrets Never Exposed to Client (NFR-1.2)
 * Ensures that server-only secrets (such as SUPABASE_SERVICE_ROLE_KEY and LIVEKIT_API_SECRET)
 * are NEVER configured into VITE_* variables or emitted in the client bundle.
 */
export function preventSecretLeakPlugin(): Plugin {
  const FORBIDDEN_SECRET_PATTERNS = [
    /SERVICE_ROLE/i,
    /LIVEKIT_API_SECRET/i,
    /SUPABASE_SERVICE_ROLE/i,
    /API_SECRET/i,
    /PRIVATE_KEY/i,
    /SECRET_KEY/i,
    /DATABASE_PASSWORD/i,
  ];

  return {
    name: 'prevent-secret-leak-plugin',
    config(_config, { mode }) {
      const loadedEnv = loadEnv(mode, process.cwd(), '');
      const allEnv: Record<string, string | undefined> = { ...process.env, ...loadedEnv };

      for (const [key, value] of Object.entries(allEnv)) {
        if (!key.startsWith('VITE_') || !value) continue;

        for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
          if (pattern.test(key)) {
            throw new Error(
              `[Security Violation - US-SEC-02] Server secret variable "${key}" must never be prefixed with VITE_ or exposed to the client!`
            );
          }
        }

        if (typeof value === 'string' && value.includes('.')) {
          try {
            const parts = value.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
              if (payload.role === 'service_role') {
                throw new Error(
                  `[Security Violation - US-SEC-02] Variable "${key}" contains a Supabase service_role JWT! Service role keys must never be exposed to the client.`
                );
              }
            }
          } catch (e: any) {
            if (e.message?.includes('Security Violation')) throw e;
          }
        }
      }
    },

    generateBundle(_options, bundle) {
      for (const [fileName, assetOrChunk] of Object.entries(bundle)) {
        const content =
          assetOrChunk.type === 'chunk'
            ? assetOrChunk.code
            : typeof assetOrChunk.source === 'string'
            ? assetOrChunk.source
            : '';

        if (!content) continue;

        if (content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
          throw new Error(
            `[Security Violation - US-SEC-02] SUPABASE_SERVICE_ROLE_KEY found in client bundle chunk "${fileName}"!`
          );
        }

        if (content.includes('LIVEKIT_API_SECRET')) {
          throw new Error(
            `[Security Violation - US-SEC-02] LIVEKIT_API_SECRET found in client bundle chunk "${fileName}"!`
          );
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'process.env.IS_PREACT': JSON.stringify('true'),
    'process.env.SUPABASE_SERVICE_ROLE_KEY': 'undefined',
    'process.env.LIVEKIT_API_SECRET': 'undefined',
  },
  plugins: [react(), preventSecretLeakPlugin()],
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
