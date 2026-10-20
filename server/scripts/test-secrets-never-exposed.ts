/**
 * Automated Verification for US-SEC-02: Secrets Never Exposed to Client
 * Priority: P0 | Traces to: NFR-1.2
 *
 * Acceptance Criteria:
 * 1. SUPABASE_SERVICE_ROLE_KEY and LIVEKIT_API_SECRET are only in server environment variables.
 * 2. No server-only secret appears in any VITE_* variable.
 */

import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${message}`);
    failed++;
  }
}

const ROOT_DIR = path.resolve(__dirname, '../..');
const CLIENT_DIR = path.resolve(ROOT_DIR, 'client');
const SERVER_DIR = path.resolve(ROOT_DIR, 'server');

function getFilesRecursively(dir: string, filter?: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        files.push(...getFilesRecursively(fullPath, filter));
      }
    } else if (!filter || filter(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseJwt(token: string): any {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

async function runTests() {
  console.log('\n============================================================');
  console.log('Running Tests for US-SEC-02: Secrets Never Exposed to Client');
  console.log('============================================================\n');

  // -------------------------------------------------------------------------
  // CRITERION 1: SUPABASE_SERVICE_ROLE_KEY and LIVEKIT_API_SECRET are only in server environment variables
  // -------------------------------------------------------------------------
  console.log('[Criterion 1] Verifying secrets are strictly server-only...');

  // 1.1 Verify server/.env.example declares SUPABASE_SERVICE_ROLE_KEY and LIVEKIT_API_SECRET
  const serverEnvExample = fs.readFileSync(path.join(SERVER_DIR, '.env.example'), 'utf-8');
  assert(
    serverEnvExample.includes('SUPABASE_SERVICE_ROLE_KEY='),
    'server/.env.example declares SUPABASE_SERVICE_ROLE_KEY'
  );
  assert(
    serverEnvExample.includes('LIVEKIT_API_SECRET='),
    'server/.env.example declares LIVEKIT_API_SECRET'
  );

  // 1.2 Verify server config/env.ts validates both server secrets
  const serverEnvConfig = fs.readFileSync(path.join(SERVER_DIR, 'src/config/env.ts'), 'utf-8');
  assert(
    serverEnvConfig.includes('SUPABASE_SERVICE_ROLE_KEY:'),
    'server/src/config/env.ts validates SUPABASE_SERVICE_ROLE_KEY'
  );
  assert(
    serverEnvConfig.includes('LIVEKIT_API_SECRET:'),
    'server/src/config/env.ts validates LIVEKIT_API_SECRET'
  );

  // 1.3 Verify client/.env.example does NOT contain any server secrets
  const clientEnvExample = fs.readFileSync(path.join(CLIENT_DIR, '.env.example'), 'utf-8');
  assert(
    !clientEnvExample.includes('SUPABASE_SERVICE_ROLE_KEY'),
    'client/.env.example does NOT contain SUPABASE_SERVICE_ROLE_KEY'
  );
  assert(
    !clientEnvExample.includes('LIVEKIT_API_SECRET'),
    'client/.env.example does NOT contain LIVEKIT_API_SECRET'
  );
  assert(
    !clientEnvExample.includes('service_role'),
    'client/.env.example does NOT reference service_role'
  );

  // 1.4 Verify client/.env (if present) does NOT contain any server secrets
  const clientEnvPath = path.join(CLIENT_DIR, '.env');
  if (fs.existsSync(clientEnvPath)) {
    const clientEnv = fs.readFileSync(clientEnvPath, 'utf-8');
    assert(
      !clientEnv.includes('SUPABASE_SERVICE_ROLE_KEY'),
      'client/.env does NOT contain SUPABASE_SERVICE_ROLE_KEY'
    );
    assert(
      !clientEnv.includes('LIVEKIT_API_SECRET'),
      'client/.env does NOT contain LIVEKIT_API_SECRET'
    );
    assert(
      !clientEnv.includes('service_role'),
      'client/.env does NOT contain any service_role token'
    );
  } else {
    assert(true, 'client/.env not present or clean');
  }

  // 1.5 Verify client source code contains zero references to server secret keys
  const clientSrcFiles = getFilesRecursively(path.join(CLIENT_DIR, 'src'), (f) =>
    /\.(ts|tsx|js|jsx)$/.test(f)
  );

  let clientSrcHasServiceRoleKey = false;
  let clientSrcHasLivekitSecret = false;
  for (const file of clientSrcFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes('SUPABASE_SERVICE_ROLE_KEY')) clientSrcHasServiceRoleKey = true;
    if (content.includes('LIVEKIT_API_SECRET')) clientSrcHasLivekitSecret = true;
  }
  assert(
    !clientSrcHasServiceRoleKey,
    'client/src contains zero references to SUPABASE_SERVICE_ROLE_KEY'
  );
  assert(
    !clientSrcHasLivekitSecret,
    'client/src contains zero references to LIVEKIT_API_SECRET'
  );

  // 1.6 Verify client Supabase client initialization uses only anon key
  const clientSupabaseTs = fs.readFileSync(path.join(CLIENT_DIR, 'src/lib/supabase.ts'), 'utf-8');
  assert(
    clientSupabaseTs.includes('VITE_SUPABASE_ANON_KEY'),
    'client/src/lib/supabase.ts uses VITE_SUPABASE_ANON_KEY'
  );
  assert(
    !clientSupabaseTs.includes('SERVICE_ROLE'),
    'client/src/lib/supabase.ts does not reference any SERVICE_ROLE key'
  );

  // -------------------------------------------------------------------------
  // CRITERION 2: No server-only secret appears in any VITE_* variable
  // -------------------------------------------------------------------------
  console.log('\n[Criterion 2] Verifying no server-only secret appears in any VITE_* variable...');

  const FORBIDDEN_SECRET_TERMS = [
    'SERVICE_ROLE',
    'SERVICE_KEY',
    'API_SECRET',
    'LIVEKIT_SECRET',
    'PRIVATE_KEY',
    'SECRET_KEY',
    'DATABASE_PASSWORD',
  ];

  // 2.1 Check all VITE_* variables in client/.env.example
  const viteVarsInExample = (clientEnvExample.match(/VITE_[A-Z0-9_]+/g) || []) as string[];
  for (const v of viteVarsInExample) {
    const hasSecretTerm = FORBIDDEN_SECRET_TERMS.some((term) => v.toUpperCase().includes(term));
    assert(!hasSecretTerm, `client/.env.example variable "${v}" contains no secret terms`);
  }

  // 2.2 Check all VITE_* variables in client/.env (if present)
  if (fs.existsSync(clientEnvPath)) {
    const clientEnv = fs.readFileSync(clientEnvPath, 'utf-8');
    const lines = clientEnv.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim();

      if (key.startsWith('VITE_')) {
        const hasSecretTerm = FORBIDDEN_SECRET_TERMS.some((term) =>
          key.toUpperCase().includes(term)
        );
        assert(!hasSecretTerm, `client/.env variable "${key}" is not a secret identifier`);

        // Check if value is a JWT and verify role is NOT service_role
        const jwtPayload = parseJwt(val);
        if (jwtPayload) {
          assert(
            jwtPayload.role !== 'service_role',
            `client/.env variable "${key}" JWT role is "${jwtPayload.role}", NOT "service_role"`
          );
        }
      }
    }
  }

  // 2.3 Verify Vite security plugin blocks forbidden VITE_* variables
  const { preventSecretLeakPlugin } = await import(path.join(CLIENT_DIR, 'vite.config.ts'));
  assert(
    typeof preventSecretLeakPlugin === 'function',
    'Vite security plugin preventSecretLeakPlugin is exported'
  );

  const plugin = preventSecretLeakPlugin();

  // Test plugin config validation with forbidden secret variable name
  let blockedSecretVarName = false;
  try {
    const originalEnv = process.env;
    process.env = { ...originalEnv, VITE_SUPABASE_SERVICE_ROLE_KEY: 'forbidden-key' };
    (plugin as any).config({}, { mode: 'test' });
    process.env = originalEnv;
  } catch (err: any) {
    if (err.message && err.message.includes('Security Violation')) {
      blockedSecretVarName = true;
    }
  }
  assert(blockedSecretVarName, 'Vite security plugin blocks VITE_SUPABASE_SERVICE_ROLE_KEY');

  // Test plugin config validation with service_role JWT in VITE_*
  let blockedServiceRoleJwt = false;
  try {
    const originalEnv = process.env;
    const fakeServiceRoleJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.signature';
    process.env = { ...originalEnv, VITE_CUSTOM_KEY: fakeServiceRoleJwt };
    (plugin as any).config({}, { mode: 'test' });
    process.env = originalEnv;
  } catch (err: any) {
    if (err.message && err.message.includes('Security Violation')) {
      blockedServiceRoleJwt = true;
    }
  }
  assert(blockedServiceRoleJwt, 'Vite security plugin blocks service_role JWT in VITE_* variable');

  // Test plugin config validation with livekit secret variable name
  let blockedLivekitSecret = false;
  try {
    const originalEnv = process.env;
    process.env = { ...originalEnv, VITE_LIVEKIT_API_SECRET: 'super-secret' };
    (plugin as any).config({}, { mode: 'test' });
    process.env = originalEnv;
  } catch (err: any) {
    if (err.message && err.message.includes('Security Violation')) {
      blockedLivekitSecret = true;
    }
  }
  assert(blockedLivekitSecret, 'Vite security plugin blocks VITE_LIVEKIT_API_SECRET');

  // Test plugin bundle inspection rejects chunks containing secret keywords
  let blockedBundleWithSecret = false;
  try {
    (plugin as any).generateBundle(
      {},
      {
        'main.js': {
          type: 'chunk',
          code: 'console.log("leaked SUPABASE_SERVICE_ROLE_KEY");',
        },
      }
    );
  } catch (err: any) {
    if (err.message && err.message.includes('Security Violation')) {
      blockedBundleWithSecret = true;
    }
  }
  assert(blockedBundleWithSecret, 'Vite bundle hook blocks SUPABASE_SERVICE_ROLE_KEY in output chunks');

  // -------------------------------------------------------------------------
  // CRITERION 3: Verification of Built Client Bundle Assets
  // -------------------------------------------------------------------------
  console.log('\n[Criterion 3] Verifying production client bundle assets in client/dist...');

  const distDir = path.join(CLIENT_DIR, 'dist/assets');
  if (fs.existsSync(distDir)) {
    const distFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
    assert(distFiles.length > 0, `client/dist/assets contains ${distFiles.length} JS bundle chunks`);

    // Read server's actual SUPABASE_SERVICE_ROLE_KEY from server/.env if available
    let actualServerServiceRoleKey = '';
    const serverEnvPath = path.join(SERVER_DIR, '.env');
    if (fs.existsSync(serverEnvPath)) {
      const match = fs.readFileSync(serverEnvPath, 'utf-8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
      if (match) actualServerServiceRoleKey = match[1].trim();
    }

    let foundServiceRoleIdentifier = false;
    let foundLivekitSecretIdentifier = false;
    let foundActualServiceRoleKey = false;
    let foundServiceRolePayload = false;

    for (const chunk of distFiles) {
      const code = fs.readFileSync(path.join(distDir, chunk), 'utf-8');
      if (code.includes('SUPABASE_SERVICE_ROLE_KEY')) foundServiceRoleIdentifier = true;
      if (code.includes('LIVEKIT_API_SECRET')) foundLivekitSecretIdentifier = true;
      if (actualServerServiceRoleKey && code.includes(actualServerServiceRoleKey)) {
        foundActualServiceRoleKey = true;
      }
      if (code.includes('"role":"service_role"') || code.includes("'role':'service_role'")) {
        foundServiceRolePayload = true;
      }
    }

    assert(
      !foundServiceRoleIdentifier,
      'No chunk in client/dist contains SUPABASE_SERVICE_ROLE_KEY'
    );
    assert(
      !foundLivekitSecretIdentifier,
      'No chunk in client/dist contains LIVEKIT_API_SECRET'
    );
    assert(
      !foundServiceRolePayload,
      'No chunk in client/dist contains "role":"service_role"'
    );
    if (actualServerServiceRoleKey) {
      assert(
        !foundActualServiceRoleKey,
        'Server SUPABASE_SERVICE_ROLE_KEY secret value is completely absent from client bundle'
      );
    }
  } else {
    console.warn('  ⚠️ client/dist not found; run npm run build in client to produce bundles.');
  }

  console.log('\n============================================================');
  console.log(`Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
