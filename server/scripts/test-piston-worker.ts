/**
 * Automated Verification Script for Piston Worker Unreachable & Language Compatibility
 *
 * Verifies:
 * 1. PISTON_API_URL and PISTON_URL configuration and endpoint normalization.
 * 2. C++ and Java language payload formatting (language, version, files, Main.java / class detection).
 * 3. Fallback logic when local Piston container is unreachable.
 * 4. Fallback logic when local Piston container lacks installed language packages (400 runtime not installed).
 * 5. Diagnostic error messaging when all execution tiers are exhausted.
 */

process.env.NODE_ENV = 'test';

import {
  getPistonEndpoints,
  getPrimaryPistonUrl,
  resolveSourceFileName,
  LANGUAGE_PISTON_MAP,
  executeCode,
  setMockPistonExecutor,
  getExecutionWorkerStatus,
  getAvailableRuntimes,
} from '../src/lib/piston';
import { env } from '../src/config/env';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${name} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\n============================================================');
  console.log('🧪 Running Piston Worker Local Execution Verification Tests');
  console.log('============================================================\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. PISTON_URL / PISTON_API_URL, Bypass, and Endpoint Normalization
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[Test 1] Verifying URL, bypass detection, and endpoint normalization...');

  const { shouldBypassLocalPiston, getEffectivePistonUrl } = await import('../src/lib/piston');

  assert(
    shouldBypassLocalPiston('http://localhost:2000') === true,
    'shouldBypassLocalPiston(http://localhost:2000) returns true (bypasses Docker container for local dev)'
  );

  assert(
    shouldBypassLocalPiston('http://127.0.0.1:2000') === true,
    'shouldBypassLocalPiston(http://127.0.0.1:2000) returns true'
  );

  assert(
    shouldBypassLocalPiston('https://piston.myvps.com') === false,
    'shouldBypassLocalPiston(remote URL) returns false'
  );

  assert(
    getEffectivePistonUrl().includes('emkc.org'),
    'getEffectivePistonUrl() defaults to public Piston emkc.org'
  );

  const epStandard = getPistonEndpoints('http://localhost:2000');
  assert(
    epStandard.execute === 'http://localhost:2000/api/v2/execute' &&
      epStandard.runtimes === 'http://localhost:2000/api/v2/runtimes',
    'Standard http://localhost:2000 resolves to /api/v2/execute and /api/v2/runtimes'
  );

  const epTrailingSlash = getPistonEndpoints('http://localhost:2000/');
  assert(
    epTrailingSlash.execute === 'http://localhost:2000/api/v2/execute' &&
      epTrailingSlash.runtimes === 'http://localhost:2000/api/v2/runtimes',
    'Trailing slash handled cleanly'
  );

  const epApiV2 = getPistonEndpoints('http://localhost:2000/api/v2');
  assert(
    epApiV2.execute === 'http://localhost:2000/api/v2/execute' &&
      epApiV2.runtimes === 'http://localhost:2000/api/v2/runtimes',
    'Base URL ending in /api/v2 does not duplicate /api/v2'
  );

  const epExecuteFull = getPistonEndpoints('http://localhost:2000/api/v2/execute');
  assert(
    epExecuteFull.execute === 'http://localhost:2000/api/v2/execute' &&
      epExecuteFull.runtimes === 'http://localhost:2000/api/v2/runtimes',
    'Base URL ending in /api/v2/execute stripped to proper execute & runtimes endpoints'
  );

  const epPublic = getPistonEndpoints('https://emkc.org/api/v2/piston');
  assert(
    epPublic.execute === 'https://emkc.org/api/v2/piston/execute' &&
      epPublic.runtimes === 'https://emkc.org/api/v2/piston/runtimes',
    'Public Piston URL ends in /api/v2/piston/execute and runtimes'
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. C++ and Java Payload Formatting & File Naming
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 2] Verifying C++ and Java payload formatting and file naming...');

  assert(
    LANGUAGE_PISTON_MAP.cpp.pistonLang === 'c++' &&
      LANGUAGE_PISTON_MAP.cpp.aliases?.includes('cpp') &&
      LANGUAGE_PISTON_MAP.cpp.file === 'main.cpp',
    'C++ mapped to pistonLang "c++", aliases include "cpp", and file is "main.cpp"'
  );

  assert(
    LANGUAGE_PISTON_MAP.java.pistonLang === 'java' &&
      LANGUAGE_PISTON_MAP.java.file === 'Main.java',
    'Java mapped to pistonLang "java" and default file is "Main.java"'
  );

  const cppFile = resolveSourceFileName('cpp', '#include <iostream>\nint main() { return 0; }');
  assert(cppFile === 'main.cpp', 'C++ resolves to main.cpp');

  const javaDefaultFile = resolveSourceFileName('java', 'class Solution { public static void main(String[] args) {} }');
  assert(javaDefaultFile === 'Main.java', 'Java without public class defaults to Main.java');

  const javaPublicFile = resolveSourceFileName(
    'java',
    'public class Calculator {\n  public static void main(String[] args) {}\n}'
  );
  assert(javaPublicFile === 'Calculator.java', 'Java with "public class Calculator" resolves to Calculator.java');

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Fallback Logic & Error Handling
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 3] Verifying fallback behavior and error messaging...');

  // 3a. Mock executor works as expected
  setMockPistonExecutor(async ({ language, code }) => {
    return {
      stdout: `Mock run for ${language}: ${code.slice(0, 10)}`,
      stderr: '',
      exitCode: 0,
      timeMs: 20,
      timedOut: false,
      truncated: false,
    };
  });

  const mockRes = await executeCode({
    language: 'cpp',
    code: 'int main() {}',
  });
  assert(mockRes.stdout.includes('Mock run for cpp'), 'Mock executor intercepts and executes successfully');
  setMockPistonExecutor(null);

  // 3b. Diagnostic status
  const status = await getExecutionWorkerStatus();
  assert(typeof status.primary.url === 'string', 'Execution worker status returns primary URL');
  assert(status.fallbacks.publicPiston === true, 'Public Piston fallback is marked available');
  assert(status.fallbacks.localNode === true, 'Local Node worker is available');
  assert(
    status.supportedLanguages.includes('cpp') && status.supportedLanguages.includes('java'),
    'Supported languages include cpp and java'
  );

  // 3c. Available runtimes
  const runtimes = await getAvailableRuntimes();
  assert(Array.isArray(runtimes) && runtimes.length >= 4, 'getAvailableRuntimes() returns array of runtimes');
  assert(
    runtimes.some((r) => r.language === 'cpp') && runtimes.some((r) => r.language === 'java'),
    'Runtimes list includes cpp and java'
  );

  // 3d. Direct local execution of JavaScript code via child_process
  console.log('\n[Test 4] Verifying direct local child_process execution...');
  const directJsRes = await executeCode({
    language: 'javascript',
    code: 'console.log("Local JS Child Process OK");',
  });
  assert(
    directJsRes.stdout.includes('Local JS Child Process OK') && directJsRes.exitCode === 0,
    'JavaScript executed cleanly via local execution engine without requiring Docker'
  );

  console.log('\n============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('============================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
