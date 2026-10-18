/**
 * Automated Verification for US-SEC-03: Sandboxed Code Execution
 * Priority: P0 | Traces to: NFR-1.3
 *
 * Acceptance Criteria:
 * 1. Piston is called with run_timeout: 3000 ms, compile_timeout: 10000 ms, run_memory_limit: 256 MB.
 * 2. Stdout and stderr are each truncated to 64 KB; truncated: true is set in the response.
 * 3. Piston is not reachable from the public internet (internal Docker network only).
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import {
  RUN_TIMEOUT_MS,
  COMPILE_TIMEOUT_MS,
  RUN_MEMORY_LIMIT,
  MAX_OUTPUT_BYTES,
  buildPistonPayload,
  truncateToBytes,
  executeCode,
  setMockPistonExecutor,
} from '../src/lib/piston';
import { setCachedUser, clearTokenCache } from '../src/lib/supabase';
import { app } from '../src/app';

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
const INFRA_DIR = path.resolve(ROOT_DIR, 'infra');

function makeRequest(
  server: http.Server,
  pathName: string,
  method: string,
  headers: Record<string, string>,
  body?: any
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path: pathName,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 0, data: parsed, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function makeToken(user: { id: string; email: string; fullName: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
      user_metadata: { full_name: user.fullName },
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64');
  return `${header}.${payload}.mock-signature`;
}

async function runTests() {
  console.log('\n============================================================');
  console.log('Running Tests for US-SEC-03: Sandboxed Code Execution');
  console.log('============================================================\n');

  // -------------------------------------------------------------------------
  // CRITERION 1: Piston parameters (run_timeout, compile_timeout, run_memory_limit)
  // -------------------------------------------------------------------------
  console.log('[Criterion 1] Enforcing Piston timeouts and memory limit parameters...');

  assert(RUN_TIMEOUT_MS === 3000, `RUN_TIMEOUT_MS is 3000 ms (actual: ${RUN_TIMEOUT_MS})`);
  assert(COMPILE_TIMEOUT_MS === 10000, `COMPILE_TIMEOUT_MS is 10000 ms (actual: ${COMPILE_TIMEOUT_MS})`);
  assert(
    RUN_MEMORY_LIMIT === 268435456,
    `RUN_MEMORY_LIMIT is 256 MB (268,435,456 bytes) (actual: ${RUN_MEMORY_LIMIT})`
  );

  const testLanguages: Array<'python' | 'javascript' | 'cpp' | 'java'> = [
    'python',
    'javascript',
    'cpp',
    'java',
  ];

  for (const lang of testLanguages) {
    const payload = buildPistonPayload({
      language: lang,
      code: 'print("hello")',
      stdin: 'input',
    });

    assert(payload.run_timeout === 3000, `[${lang}] payload.run_timeout is 3000 ms`);
    assert(payload.compile_timeout === 10000, `[${lang}] payload.compile_timeout is 10000 ms`);
    assert(
      payload.run_memory_limit === 268435456,
      `[${lang}] payload.run_memory_limit is 256 MB (268,435,456 bytes)`
    );
  }

  // -------------------------------------------------------------------------
  // CRITERION 2: Truncation of stdout and stderr to 64 KB and truncated: true
  // -------------------------------------------------------------------------
  console.log('\n[Criterion 2] Verifying 64 KB truncation on stdout and stderr...');

  assert(MAX_OUTPUT_BYTES === 65536, `MAX_OUTPUT_BYTES is 64 KB (65,536 bytes) (actual: ${MAX_OUTPUT_BYTES})`);

  // 2.1 truncateToBytes unit tests
  const smallText = 'Hello World!';
  const smallRes = truncateToBytes(smallText);
  assert(smallRes.text === smallText && smallRes.truncated === false, 'Small text (<64 KB) is not truncated');

  const exact64kb = 'A'.repeat(65536);
  const exactRes = truncateToBytes(exact64kb);
  assert(
    Buffer.byteLength(exactRes.text, 'utf8') === 65536 && exactRes.truncated === false,
    'Exact 64 KB text is not truncated'
  );

  const oversized70kb = 'B'.repeat(70000);
  const overRes = truncateToBytes(oversized70kb);
  assert(
    Buffer.byteLength(overRes.text, 'utf8') === 65536 && overRes.truncated === true,
    '70 KB text is truncated to exactly 65,536 bytes with truncated: true'
  );

  // 2.2 executeCode with mock executor returning oversized stdout
  setMockPistonExecutor(async () => ({
    stdout: 'X'.repeat(80000),
    stderr: 'No errors',
    exitCode: 0,
    timeMs: 120,
    timedOut: false,
    truncated: false,
  }));

  const execStdoutOversized = await executeCode({
    language: 'python',
    code: 'print("X" * 80000)',
  });
  assert(
    Buffer.byteLength(execStdoutOversized.stdout, 'utf8') === 65536,
    'executeCode truncates oversized stdout to 64 KB'
  );
  assert(execStdoutOversized.stderr === 'No errors', 'executeCode preserves untruncated stderr');
  assert(execStdoutOversized.truncated === true, 'executeCode sets truncated: true on oversized stdout');

  // 2.3 executeCode with mock executor returning oversized stderr
  setMockPistonExecutor(async () => ({
    stdout: 'Normal output',
    stderr: 'E'.repeat(90000),
    exitCode: 1,
    timeMs: 150,
    timedOut: false,
    truncated: false,
  }));

  const execStderrOversized = await executeCode({
    language: 'python',
    code: 'raise Exception()',
  });
  assert(execStderrOversized.stdout === 'Normal output', 'executeCode preserves untruncated stdout');
  assert(
    Buffer.byteLength(execStderrOversized.stderr, 'utf8') === 65536,
    'executeCode truncates oversized stderr to 64 KB'
  );
  assert(execStderrOversized.truncated === true, 'executeCode sets truncated: true on oversized stderr');

  // 2.4 executeCode with both under 64 KB
  setMockPistonExecutor(async () => ({
    stdout: 'Success',
    stderr: '',
    exitCode: 0,
    timeMs: 50,
    timedOut: false,
    truncated: false,
  }));

  const execNormal = await executeCode({
    language: 'javascript',
    code: 'console.log("Success")',
  });
  assert(execNormal.truncated === false, 'executeCode sets truncated: false when output is within limits');

  // 2.5 HTTP integration verification via POST /api/execute
  const testServer = http.createServer(app);
  await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', () => resolve()));

  const studentUser = { id: 'user-sec-student-01', email: 'student@linkup.test', fullName: 'Student Sam', role: 'student' as const };
  const studentToken = makeToken(studentUser);
  setCachedUser(studentToken, studentUser);

  setMockPistonExecutor(async () => ({
    stdout: 'Z'.repeat(100000),
    stderr: 'Warning: output truncated',
    exitCode: 0,
    timeMs: 95,
    timedOut: false,
    truncated: false,
  }));

  const httpRes = await makeRequest(
    testServer,
    '/api/execute',
    'POST',
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentToken}`,
    },
    {
      language: 'python',
      code: 'print("Z" * 100000)',
    }
  );

  assert(httpRes.status === 200, 'POST /api/execute returns HTTP 200');
  assert(
    Buffer.byteLength(httpRes.data.stdout, 'utf8') === 65536,
    'POST /api/execute response stdout is capped at 64 KB'
  );
  assert(httpRes.data.truncated === true, 'POST /api/execute response includes truncated: true');

  // Reset mock executor
  setMockPistonExecutor(null);
  testServer.close();

  // -------------------------------------------------------------------------
  // CRITERION 3: Piston is not reachable from public internet (internal network only)
  // -------------------------------------------------------------------------
  console.log('\n[Criterion 3] Verifying Piston network isolation...');

  // 3.1 Verify infra/deploy/docker-compose.prod.yml
  const prodComposePath = path.join(INFRA_DIR, 'deploy/docker-compose.prod.yml');
  assert(fs.existsSync(prodComposePath), 'infra/deploy/docker-compose.prod.yml exists');

  const prodComposeContent = fs.readFileSync(prodComposePath, 'utf-8');
  assert(
    prodComposeContent.includes('piston:'),
    'docker-compose.prod.yml defines piston service'
  );
  assert(
    !/piston:[\s\S]*?ports:\s*\n\s*-\s*["']?2000:2000/.test(prodComposeContent),
    'docker-compose.prod.yml does NOT publish Piston port 2000 to host or public internet'
  );
  assert(
    prodComposeContent.includes('expose:') && prodComposeContent.includes('2000'),
    'docker-compose.prod.yml exposes Piston on internal network only'
  );
  assert(
    prodComposeContent.includes('internal-net'),
    'docker-compose.prod.yml connects services via internal-net network'
  );

  // 3.2 Verify infra/deploy/Caddyfile does NOT route to Piston
  const caddyfilePath = path.join(INFRA_DIR, 'deploy/Caddyfile');
  assert(fs.existsSync(caddyfilePath), 'infra/deploy/Caddyfile exists');

  const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf-8');
  assert(
    !caddyfileContent.includes('piston:2000') && !caddyfileContent.includes(':2000'),
    'Caddyfile does NOT route public traffic to Piston'
  );
  assert(
    caddyfileContent.includes('server:3001'),
    'Caddyfile routes public traffic solely to Express backend'
  );

  // 3.3 Verify infra/piston/docker-compose.yml binds to localhost only for dev
  const devPistonComposePath = path.join(INFRA_DIR, 'piston/docker-compose.yml');
  assert(fs.existsSync(devPistonComposePath), 'infra/piston/docker-compose.yml exists');

  const devPistonCompose = fs.readFileSync(devPistonComposePath, 'utf-8');
  assert(
    devPistonCompose.includes('127.0.0.1:2000:2000'),
    'infra/piston/docker-compose.yml binds port 2000 exclusively to 127.0.0.1 (localhost)'
  );
  assert(
    !devPistonCompose.includes('"2000:2000"') && !devPistonCompose.includes('"0.0.0.0:2000:2000"'),
    'infra/piston/docker-compose.yml does NOT bind port 2000 to public 0.0.0.0'
  );

  // 3.4 Verify Express routes do not expose raw Piston endpoints
  const serverAppContent = fs.readFileSync(path.join(ROOT_DIR, 'server/src/app.ts'), 'utf-8');
  assert(
    !serverAppContent.includes("app.all('/api/v2/*'") &&
      !serverAppContent.includes("app.use('/api/v2'"),
    'Express server does not proxy raw /api/v2/* Piston endpoints'
  );
  assert(
    serverAppContent.includes("app.post('/api/execute'"),
    'Express server gates code execution through authenticated /api/execute endpoint'
  );

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
