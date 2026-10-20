import { Language, RunResult } from '@linkup/shared';
import { env } from '../config/env';

export interface PistonRuntime {
  language: Language;
  version: string;
}

export const LANGUAGE_PISTON_MAP: Record<Language, { pistonLang: string; file: string; defaultVersion: string }> = {
  python: { pistonLang: 'python', file: 'main.py', defaultVersion: '3.10.0' },
  javascript: { pistonLang: 'javascript', file: 'index.js', defaultVersion: '18.15.0' },
  cpp: { pistonLang: 'c++', file: 'main.cpp', defaultVersion: '10.2.0' },
  java: { pistonLang: 'java', file: 'Main.java', defaultVersion: '15.0.2' },
};

export const RUN_TIMEOUT_MS = 3000;
export const COMPILE_TIMEOUT_MS = 10000;
export const RUN_MEMORY_LIMIT = 268435456; // 256 MB
export const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB
export const MAX_CODE_BYTES = 64 * 1024; // 64 KB
export const MAX_STDIN_BYTES = 8 * 1024; // 8 KB

// In-memory rate limiting: userId -> timestamps of execution requests
const userRunTimestamps = new Map<string, number[]>();

export function checkRunRateLimit(userId: string): { allowed: boolean } {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRuns = 10;

  const timestamps = (userRunTimestamps.get(userId) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRuns) {
    userRunTimestamps.set(userId, timestamps);
    return { allowed: false };
  }

  timestamps.push(now);
  userRunTimestamps.set(userId, timestamps);
  return { allowed: true };
}

export function clearRunRateLimits(): void {
  userRunTimestamps.clear();
}

export type MockExecutorFn = (options: {
  language: Language;
  code: string;
  stdin?: string;
}) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  timedOut: boolean;
  truncated: boolean;
}>;

let mockExecutor: MockExecutorFn | null = null;

export function setMockPistonExecutor(fn: MockExecutorFn | null): void {
  mockExecutor = fn;
}

/**
 * Returns available runtimes for Linkup.
 */
export async function getAvailableRuntimes(): Promise<PistonRuntime[]> {
  try {
    const res = await fetch(`${env.PISTON_URL}/api/v2/runtimes`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = (await res.json()) as Array<{ language: string; version: string; aliases: string[] }>;
      const runtimes: PistonRuntime[] = [];

      for (const [langKey, config] of Object.entries(LANGUAGE_PISTON_MAP) as [Language, typeof LANGUAGE_PISTON_MAP[Language]][]) {
        const found = data.find(
          (r) => r.language === config.pistonLang || (r.aliases && r.aliases.includes(config.pistonLang))
        );
        runtimes.push({
          language: langKey,
          version: found?.version || config.defaultVersion,
        });
      }
      return runtimes;
    }
  } catch {
    // Fall back to default versions if Piston is unreachable
  }

  return Object.entries(LANGUAGE_PISTON_MAP).map(([langKey, config]) => ({
    language: langKey as Language,
    version: config.defaultVersion,
  }));
}

/**
 * Truncate string to maxBytes in UTF-8.
 */
export function truncateToBytes(str: string, maxBytes: number = MAX_OUTPUT_BYTES): { text: string; truncated: boolean } {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) {
    return { text: str, truncated: false };
  }

  let buf = Buffer.from(str, 'utf8').subarray(0, maxBytes);
  // Ensure valid UTF-8 boundary
  return { text: buf.toString('utf8'), truncated: true };
}

/**
 * Builds the payload sent to Piston with all sandboxing limits enforced (US-SEC-03 / NFR-1.3):
 * - run_timeout: 3000 ms
 * - compile_timeout: 10000 ms
 * - run_memory_limit: 256 MB (268,435,456 bytes)
 */
export function buildPistonPayload(options: {
  language: Language;
  code: string;
  stdin?: string;
}) {
  const langConfig = LANGUAGE_PISTON_MAP[options.language];
  if (!langConfig) {
    throw Object.assign(new Error(`Unsupported language: ${options.language}`), { status: 400, code: 'VALIDATION' });
  }

  return {
    language: langConfig.pistonLang,
    version: '*',
    files: [
      {
        name: langConfig.file,
        content: options.code,
      },
    ],
    stdin: options.stdin || '',
    run_timeout: RUN_TIMEOUT_MS,
    compile_timeout: COMPILE_TIMEOUT_MS,
    run_memory_limit: RUN_MEMORY_LIMIT,
    compile_memory_limit: RUN_MEMORY_LIMIT,
  };
}

/**
 * Execute code via Piston sandbox.
 * Enforces run_timeout (3s), compile_timeout (10s), run_memory_limit (256MB), and 64KB output truncation.
 */
export async function executeCode(options: {
  language: Language;
  code: string;
  stdin?: string;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  timedOut: boolean;
  truncated: boolean;
}> {
  const { language, code, stdin } = options;

  if (mockExecutor) {
    const res = await mockExecutor(options);
    const stdoutTrunc = truncateToBytes(res.stdout || '', MAX_OUTPUT_BYTES);
    const stderrTrunc = truncateToBytes(res.stderr || '', MAX_OUTPUT_BYTES);
    return {
      ...res,
      stdout: stdoutTrunc.text,
      stderr: stderrTrunc.text,
      truncated: res.truncated || stdoutTrunc.truncated || stderrTrunc.truncated,
    };
  }

  const startTime = Date.now();
  const payload = buildPistonPayload(options);

  let response: Response;
  try {
    response = await fetch(`${env.PISTON_URL}/api/v2/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS + 2000), // Grace buffer
    });
  } catch (err: any) {
    console.error('[Piston] Connection error:', err.message);
    throw Object.assign(new Error('Code execution service is currently unavailable'), {
      status: 502,
      code: 'EXECUTION_UNAVAILABLE',
    });
  }

  if (!response.ok) {
    if (response.status === 400) {
      const errJson: any = await response.json().catch(() => ({}));
      throw Object.assign(new Error(errJson.message || 'Piston request rejected'), {
        status: 400,
        code: 'VALIDATION',
      });
    }
    throw Object.assign(new Error('Code execution service is currently unavailable'), {
      status: 502,
      code: 'EXECUTION_UNAVAILABLE',
    });
  }

  const data: any = await response.json();
  const elapsedMs = Date.now() - startTime;

  let rawStdout = '';
  let rawStderr = '';
  let exitCode: number | null = 0;
  let timedOut = false;

  // Handle compile step error or timeout if any (e.g. C++ or Java compilation)
  if (data.compile) {
    if (data.compile.stdout) rawStdout += data.compile.stdout;
    if (data.compile.stderr) rawStderr += data.compile.stderr;
    if (data.compile.code !== 0 && data.compile.code !== null) {
      exitCode = data.compile.code;
    }
    if (
      data.compile.signal === 'SIGKILL' ||
      data.compile.signal === 'SIGTERM' ||
      data.compile.signal === 'SIGXCPU' ||
      data.compile.output?.includes('Time limit exceeded') ||
      elapsedMs >= COMPILE_TIMEOUT_MS
    ) {
      timedOut = true;
    }
  }

  if (data.run) {
    if (data.run.stdout) rawStdout += data.run.stdout;
    if (data.run.stderr) rawStderr += data.run.stderr;
    if (data.run.code !== null && data.run.code !== undefined) {
      exitCode = data.run.code;
    }
    // Piston signals SIGKILL or signal on timeout
    if (
      data.run.signal === 'SIGKILL' ||
      data.run.signal === 'SIGTERM' ||
      data.run.signal === 'SIGXCPU' ||
      data.run.output?.includes('Time limit exceeded') ||
      elapsedMs >= RUN_TIMEOUT_MS
    ) {
      timedOut = true;
    }
  }

  if (timedOut) {
    if (!rawStderr.includes('Time limit exceeded (3 s).')) {
      rawStderr = rawStderr ? `${rawStderr}\nTime limit exceeded (3 s).` : 'Time limit exceeded (3 s).';
    }
  }

  // Enforce 64 KB truncation on stdout and stderr (US-SEC-03 AC-2, api-contract §3.7)
  const stdoutTrunc = truncateToBytes(rawStdout, MAX_OUTPUT_BYTES);
  const stderrTrunc = truncateToBytes(rawStderr, MAX_OUTPUT_BYTES);
  const truncated = stdoutTrunc.truncated || stderrTrunc.truncated;

  return {
    stdout: stdoutTrunc.text,
    stderr: stderrTrunc.text,
    exitCode,
    timeMs: elapsedMs,
    timedOut,
    truncated,
  };
}
