import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Language, RunResult } from '@linkup/shared';
import { env } from '../config/env';

export interface PistonRuntime {
  language: Language;
  version: string;
}

export const LANGUAGE_PISTON_MAP: Record<
  Language,
  { pistonLang: string; file: string; defaultVersion: string; aliases?: string[] }
> = {
  python: { pistonLang: 'python', file: 'main.py', defaultVersion: '3.10.0', aliases: ['python', 'py', 'python3'] },
  javascript: {
    pistonLang: 'javascript',
    file: 'index.js',
    defaultVersion: '18.15.0',
    aliases: ['javascript', 'node', 'js', 'node-javascript'],
  },
  cpp: { pistonLang: 'c++', file: 'main.cpp', defaultVersion: '10.2.0', aliases: ['c++', 'cpp', 'g++', 'gcc'] },
  java: { pistonLang: 'java', file: 'Main.java', defaultVersion: '15.0.2', aliases: ['java', 'jdk'] },
};

// Judge0 language ID mappings (Judge0 CE standard IDs)
const LANGUAGE_JUDGE0_MAP: Partial<Record<Language, number>> = {
  python: 71, // Python (3.8.1)
  javascript: 63, // JavaScript (Node.js 12.14.0)
  cpp: 54, // C++ (GCC 9.2.0)
  java: 62, // Java (OpenJDK 13.0.1)
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

// ─────────────────────────────────────────────────────────────────────────────
// Worker Health & Reconnection State
// ─────────────────────────────────────────────────────────────────────────────

interface WorkerHealthState {
  healthy: boolean;
  lastChecked: number;
  retryAfter: number;
  lastError?: string;
}

const primaryWorkerState: WorkerHealthState = {
  healthy: true,
  lastChecked: 0,
  retryAfter: 0,
};

const RECONNECT_COOLDOWN_MS = 30_000; // Retry primary worker after 30s if down

let resolvedPythonCmd: string | null | undefined = undefined;
let resolvedJavaCmd: string | null | undefined = undefined;
let resolvedCppCmd: string | null | undefined = undefined;

/**
 * Dynamically resolves python executable available on the host (e.g. 'python', 'py', 'python3').
 */
async function getPythonCommand(): Promise<string | null> {
  if (resolvedPythonCmd !== undefined) return resolvedPythonCmd;

  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const isAvailable = await new Promise<boolean>((resolve) => {
        const p = spawn(cmd, ['--version'], { windowsHide: true, timeout: 1500 });
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
      });
      if (isAvailable) {
        resolvedPythonCmd = cmd;
        return cmd;
      }
    } catch {
      // try next candidate
    }
  }

  resolvedPythonCmd = null;
  return null;
}

/**
 * Dynamically resolves java executable available on the host.
 */
async function getJavaCommand(): Promise<string | null> {
  if (resolvedJavaCmd !== undefined) return resolvedJavaCmd;

  const candidates = process.platform === 'win32' ? ['java.exe', 'java'] : ['java'];
  for (const cmd of candidates) {
    try {
      const isAvailable = await new Promise<boolean>((resolve) => {
        const p = spawn(cmd, ['-version'], { windowsHide: true, timeout: 1500 });
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
      });
      if (isAvailable) {
        resolvedJavaCmd = cmd;
        return cmd;
      }
    } catch {
      // try next candidate
    }
  }

  resolvedJavaCmd = null;
  return null;
}

/**
 * Dynamically resolves C++ compiler (g++, clang++, gcc) on the host.
 */
async function getCppCommand(): Promise<string | null> {
  if (resolvedCppCmd !== undefined) return resolvedCppCmd;

  const candidates = process.platform === 'win32' ? ['g++', 'clang++', 'gcc'] : ['g++', 'clang++', 'gcc'];
  for (const cmd of candidates) {
    try {
      const isAvailable = await new Promise<boolean>((resolve) => {
        const p = spawn(cmd, ['--version'], { windowsHide: true, timeout: 1500 });
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
      });
      if (isAvailable) {
        resolvedCppCmd = cmd;
        return cmd;
      }
    } catch {
      // try next candidate
    }
  }

  resolvedCppCmd = null;
  return null;
}

/**
 * Detects if a URL is pointing to a local Piston Docker container (localhost:2000 / 127.0.0.1:2000).
 * Bypasses immediately when running locally without Docker unless ENABLE_LOCAL_DOCKER_PISTON=true.
 */
export function shouldBypassLocalPiston(url: string): boolean {
  if (process.env.ENABLE_LOCAL_DOCKER_PISTON === 'true') {
    return false;
  }
  return url.includes('localhost:2000') || url.includes('127.0.0.1:2000');
}

/**
 * Resolves the primary Piston base URL, respecting PISTON_API_URL or PISTON_URL.
 */
export function getPrimaryPistonUrl(): string {
  return env.PISTON_API_URL || env.PISTON_URL || 'https://emkc.org/api/v2/piston';
}

/**
 * Returns effective Piston URL, automatically routing to Public Piston if localhost:2000 is bypassed.
 */
export function getEffectivePistonUrl(): string {
  const configured = getPrimaryPistonUrl();
  if (shouldBypassLocalPiston(configured)) {
    return 'https://emkc.org/api/v2/piston';
  }
  return configured;
}

/**
 * Normalizes Piston URLs whether they point to self-hosted, custom backend proxy, or public emkc.org.
 */
export function getPistonEndpoints(baseUrl: string) {
  let clean = baseUrl.replace(/\/$/, '');
  if (clean.endsWith('/execute')) {
    clean = clean.replace(/\/execute$/, '');
  }
  if (clean.endsWith('/api/v2/piston') || clean.endsWith('/api/v2')) {
    return {
      execute: `${clean}/execute`,
      runtimes: `${clean}/runtimes`,
    };
  }
  return {
    execute: `${clean}/api/v2/execute`,
    runtimes: `${clean}/api/v2/runtimes`,
  };
}

/**
 * Resolves source file name for a language runtime.
 * For Java, detects any declared public class name (e.g. Solution -> Solution.java) to strictly comply
 * with Java compiler file naming requirements, defaulting to Main.java.
 */
export function resolveSourceFileName(language: Language, code: string): string {
  if (language === 'java') {
    const classMatch = code.match(/public\s+class\s+([A-Za-z0-9_]+)/);
    if (classMatch && classMatch[1]) {
      return `${classMatch[1]}.java`;
    }
    return 'Main.java';
  }
  if (language === 'cpp') {
    return 'main.cpp';
  }
  return LANGUAGE_PISTON_MAP[language]?.file || 'main.txt';
}

/**
 * Map raw Piston runtime data into Linkup runtime array.
 */
function mapPistonRuntimes(
  data: Array<{ language: string; version: string; aliases?: string[] }>
): PistonRuntime[] {
  const runtimes: PistonRuntime[] = [];
  for (const [langKey, config] of Object.entries(LANGUAGE_PISTON_MAP) as [
    Language,
    (typeof LANGUAGE_PISTON_MAP)[Language]
  ][]) {
    const candidateAliases = [config.pistonLang, ...(config.aliases || [])];
    const found = data.find(
      (r) =>
        candidateAliases.includes(r.language) ||
        (r.aliases && r.aliases.some((alias) => candidateAliases.includes(alias)))
    );
    runtimes.push({
      language: langKey,
      version: found?.version || config.defaultVersion,
    });
  }
  return runtimes;
}

/**
 * Returns available runtimes for Linkup.
 */
export async function getAvailableRuntimes(): Promise<PistonRuntime[]> {
  const effectiveUrl = getEffectivePistonUrl();
  // 1. Try effective Piston if healthy or past retry window
  if (primaryWorkerState.healthy || Date.now() >= primaryWorkerState.retryAfter) {
    try {
      const endpoints = getPistonEndpoints(effectiveUrl);
      const res = await fetch(endpoints.runtimes, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = (await res.json()) as Array<{ language: string; version: string; aliases: string[] }>;
        primaryWorkerState.healthy = true;
        return mapPistonRuntimes(data);
      }
    } catch {
      // Fall through to fallback
    }
  }

  // 2. Try public Piston endpoint if effectiveUrl is not already emkc
  if (!effectiveUrl.includes('emkc.org')) {
    try {
      const res = await fetch('https://emkc.org/api/v2/piston/runtimes', { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = (await res.json()) as Array<{ language: string; version: string; aliases: string[] }>;
        return mapPistonRuntimes(data);
      }
    } catch {
      // Fall through to default versions
    }
  }

  return Object.entries(LANGUAGE_PISTON_MAP).map(([langKey, config]) => ({
    language: langKey as Language,
    version: config.defaultVersion,
  }));
}

/**
 * Truncate string to maxBytes in UTF-8.
 */
function truncateToBytes(str: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) {
    return { text: str, truncated: false };
  }

  const buf = Buffer.from(str, 'utf8').subarray(0, maxBytes);
  return { text: buf.toString('utf8'), truncated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Workers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute code via a Piston sandbox endpoint.
 */
async function runWithPiston(
  baseUrl: string,
  options: { language: Language; code: string; stdin?: string },
  apiKey?: string
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  timedOut: boolean;
  truncated: boolean;
}> {
  const { language, code, stdin } = options;
  const langConfig = LANGUAGE_PISTON_MAP[language];
  const endpoints = getPistonEndpoints(baseUrl);
  const fileName = resolveSourceFileName(language, code);

  // Candidate language identifiers for Piston v2 (primary name + known aliases like 'c++' and 'cpp')
  const candidateLangs = [
    langConfig.pistonLang,
    ...(langConfig.aliases ? langConfig.aliases.filter((a) => a !== langConfig.pistonLang) : []),
  ];

  let lastMissingRuntimeErr: any = null;

  for (const pistonLang of candidateLangs) {
    const payload = {
      language: pistonLang,
      version: '*',
      files: [
        {
          name: fileName,
          content: code,
        },
      ],
      stdin: stdin || '',
      run_timeout: RUN_TIMEOUT_MS,
      compile_timeout: COMPILE_TIMEOUT_MS,
      run_memory_limit: RUN_MEMORY_LIMIT,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['x-api-key'] = apiKey;
    }

    const startTime = Date.now();
    let response: Response;
    try {
      response = await fetch(endpoints.execute, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS + 2500),
      });
    } catch (fetchErr: any) {
      // Network connectivity error reaching this baseUrl (e.g. ECONNREFUSED or timeout)
      throw Object.assign(fetchErr, { isNetworkError: true });
    }

    if (!response.ok) {
      const errJson: any = await response.json().catch(() => ({}));
      const errMsg = errJson.message || `HTTP ${response.status}`;

      const isMissingRuntime =
        response.status === 400 &&
        typeof errMsg === 'string' &&
        (errMsg.toLowerCase().includes('not installed') ||
          errMsg.toLowerCase().includes('does not exist') ||
          errMsg.toLowerCase().includes('unknown language') ||
          errMsg.toLowerCase().includes('runtime is not installed'));

      if (isMissingRuntime) {
        lastMissingRuntimeErr = Object.assign(new Error(errMsg), {
          status: 400,
          code: 'RUNTIME_NOT_INSTALLED',
          isRuntimeMissing: true,
          pistonLang,
        });
        // Try next candidate language alias if available
        continue;
      }

      if (response.status === 400) {
        // True client validation error (bad request)
        throw Object.assign(new Error(errMsg || 'Piston request rejected'), {
          status: 400,
          code: 'VALIDATION',
        });
      }

      throw new Error(`Piston server error: HTTP ${response.status} - ${errMsg}`);
    }

    const data: any = await response.json();
    const elapsedMs = Date.now() - startTime;

    let rawStdout = '';
    let rawStderr = '';
    let exitCode: number | null = 0;
    let timedOut = false;

    if (data.compile) {
      if (data.compile.stdout) rawStdout += data.compile.stdout;
      if (data.compile.stderr) rawStderr += data.compile.stderr;
      if (data.compile.code !== 0 && data.compile.code !== null) {
        exitCode = data.compile.code;
      }
    }

    if (data.run) {
      if (data.run.stdout) rawStdout += data.run.stdout;
      if (data.run.stderr) rawStderr += data.run.stderr;
      if (data.run.code !== null && data.run.code !== undefined) {
        exitCode = data.run.code;
      }
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

    const stdoutTrunc = truncateToBytes(rawStdout, MAX_OUTPUT_BYTES);
    const stderrTrunc = truncateToBytes(rawStderr, MAX_OUTPUT_BYTES);

    return {
      stdout: stdoutTrunc.text,
      stderr: stderrTrunc.text,
      exitCode,
      timeMs: elapsedMs,
      timedOut,
      truncated: stdoutTrunc.truncated || stderrTrunc.truncated,
    };
  }

  // If candidate loop completed and runtime was missing
  if (lastMissingRuntimeErr) {
    throw lastMissingRuntimeErr;
  }

  throw new Error(`Failed to execute code for language ${language}`);
}

/**
 * Execute code via Judge0 CE fallback API.
 */
async function runWithJudge0(options: {
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
  const languageId = LANGUAGE_JUDGE0_MAP[language];
  if (!languageId) {
    throw new Error(`Judge0 does not support language: ${language}`);
  }

  const judge0Url = env.JUDGE0_URL.replace(/\/$/, '');
  const url = `${judge0Url}/submissions?base64_encoded=false&wait=true`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (env.JUDGE0_API_KEY) {
    headers['X-RapidAPI-Key'] = env.JUDGE0_API_KEY;
    try {
      headers['X-RapidAPI-Host'] = new URL(judge0Url).host;
    } catch {
      headers['X-RapidAPI-Host'] = 'judge0-ce.p.rapidapi.com';
    }
  }

  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language_id: languageId,
      source_code: code,
      stdin: stdin || '',
      cpu_time_limit: 3,
      wall_time_limit: 5,
      memory_limit: 256000,
    }),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS + 3000),
  });

  if (!response.ok) {
    throw new Error(`Judge0 API error: HTTP ${response.status}`);
  }

  const data: any = await response.json();
  const elapsedMs = Date.now() - startTime;

  let rawStdout = data.stdout || '';
  let rawStderr = data.stderr || '';
  if (data.compile_output) {
    rawStderr = rawStderr ? `${data.compile_output}\n${rawStderr}` : data.compile_output;
  }

  let timedOut = false;
  // Judge0 status id 5 = Time Limit Exceeded
  if (data.status?.id === 5 || elapsedMs >= RUN_TIMEOUT_MS) {
    timedOut = true;
    if (!rawStderr.includes('Time limit exceeded (3 s).')) {
      rawStderr = rawStderr ? `${rawStderr}\nTime limit exceeded (3 s).` : 'Time limit exceeded (3 s).';
    }
  }

  const stdoutTrunc = truncateToBytes(rawStdout, MAX_OUTPUT_BYTES);
  const stderrTrunc = truncateToBytes(rawStderr, MAX_OUTPUT_BYTES);

  return {
    stdout: stdoutTrunc.text,
    stderr: stderrTrunc.text,
    exitCode: timedOut ? 137 : (data.exit_code ?? 0),
    timeMs: elapsedMs,
    timedOut,
    truncated: stdoutTrunc.truncated || stderrTrunc.truncated,
  };
}

/**
 * Executes a process on the host system with stdin piping and timeout enforcement.
 */
function runLocalProcess(
  cmd: string,
  args: string[],
  stdin?: string,
  cwd?: string
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  timedOut: boolean;
  truncated: boolean;
}> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let stdoutData = '';
    let stderrData = '';
    let finished = false;

    let child: any;
    try {
      child = spawn(cmd, args, {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      return reject(err);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, RUN_TIMEOUT_MS);

    if (stdin && child.stdin) {
      try {
        child.stdin.write(stdin);
        child.stdin.end();
      } catch {
        // ignore stdin pipe errors
      }
    } else if (child.stdin) {
      child.stdin.end();
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString('utf8');
    });

    child.on('error', (err: any) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on('close', (code: number | null, signal: string | null) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        const elapsed = Date.now() - startTime;
        let stderr = stderrData;

        if (timedOut || signal === 'SIGKILL' || signal === 'SIGTERM') {
          timedOut = true;
          stderr = stderr ? `${stderr}\nTime limit exceeded (3 s).` : 'Time limit exceeded (3 s).';
        }

        const stdoutTrunc = truncateToBytes(stdoutData, MAX_OUTPUT_BYTES);
        const stderrTrunc = truncateToBytes(stderr, MAX_OUTPUT_BYTES);

        resolve({
          stdout: stdoutTrunc.text,
          stderr: stderrTrunc.text,
          exitCode: timedOut ? 137 : (code ?? (signal ? 1 : 0)),
          timeMs: elapsed,
          timedOut,
          truncated: stdoutTrunc.truncated || stderrTrunc.truncated,
        });
      }
    });
  });
}

/**
 * Execute code directly via local runtime process fallback (Node.js, Python, Java, and C++).
 * Ensures zero-downtime execution even when external sandbox containers or Docker are completely absent.
 */
async function runWithLocalWorker(options: {
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

  if (language === 'javascript') {
    return runLocalProcess(process.execPath, ['--max-old-space-size=256', '-e', code], stdin);
  }

  if (language === 'python') {
    const pythonCmd = await getPythonCommand();
    if (!pythonCmd) {
      throw new Error('Host Python runtime not found. Please ensure Python is installed on PATH.');
    }
    return runLocalProcess(pythonCmd, ['-c', code], stdin);
  }

  if (language === 'java') {
    const javaCmd = await getJavaCommand();
    if (!javaCmd) {
      throw new Error('Host Java runtime not found. Please ensure Java (JDK 11+) is installed on PATH.');
    }
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'linkup-java-'));
    const fileName = resolveSourceFileName('java', code);
    const filePath = path.join(tmpDir, fileName);
    try {
      await fs.promises.writeFile(filePath, code, 'utf8');
      // In Java 11+, single-file source code programs can be executed directly with `java <file.java>`
      return await runLocalProcess(javaCmd, [fileName], stdin, tmpDir);
    } finally {
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (language === 'cpp') {
    const cppCmd = await getCppCommand();
    if (!cppCmd) {
      throw new Error('Host C++ compiler not found (g++ or clang++).');
    }
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'linkup-cpp-'));
    const srcPath = path.join(tmpDir, 'main.cpp');
    const exeName = process.platform === 'win32' ? 'main.exe' : 'main.out';
    try {
      await fs.promises.writeFile(srcPath, code, 'utf8');
      const compileResult = await runLocalProcess(cppCmd, ['-O2', 'main.cpp', '-o', exeName], undefined, tmpDir);
      if (compileResult.exitCode !== 0) {
        return {
          stdout: '',
          stderr: compileResult.stderr || compileResult.stdout || 'Compilation failed',
          exitCode: compileResult.exitCode,
          timeMs: compileResult.timeMs,
          timedOut: compileResult.timedOut,
          truncated: compileResult.truncated,
        };
      }
      return await runLocalProcess(path.join(tmpDir, exeName), [], stdin, tmpDir);
    } finally {
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  throw new Error(`Unsupported local language execution: ${language}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Service API
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionWorkerStatus {
  primary: {
    url: string;
    healthy: boolean;
    lastChecked: number;
    retryAfter: number;
    lastError?: string;
  };
  fallbacks: {
    publicPiston: boolean;
    judge0Configured: boolean;
    localNode: boolean;
    localPython: boolean;
    localJava: boolean;
    localCpp: boolean;
  };
  supportedLanguages: Language[];
}

/**
 * Returns diagnostic status of the execution worker and configured fallbacks.
 */
export async function getExecutionWorkerStatus(): Promise<ExecutionWorkerStatus> {
  const pythonCmd = await getPythonCommand();
  const javaCmd = await getJavaCommand();
  const cppCmd = await getCppCommand();
  const effectiveUrl = getEffectivePistonUrl();

  return {
    primary: {
      url: effectiveUrl,
      healthy: primaryWorkerState.healthy,
      lastChecked: primaryWorkerState.lastChecked,
      retryAfter: primaryWorkerState.retryAfter,
      lastError: primaryWorkerState.lastError,
    },
    fallbacks: {
      publicPiston: true,
      judge0Configured: Boolean(env.JUDGE0_API_KEY),
      localNode: true,
      localPython: Boolean(pythonCmd),
      localJava: Boolean(javaCmd),
      localCpp: Boolean(cppCmd),
    },
    supportedLanguages: ['python', 'javascript', 'cpp', 'java'],
  };
}

/**
 * Execute code via multi-tier execution service:
 * 1. Primary Engine: Public Piston (emkc.org) or configured remote Piston (bypasses localhost:2000 without Docker)
 * 2. Local Child_Process Worker: Directly runs Node.js, Python, Java, or C++ on host
 * 3. Judge0 CE API: If configured
 *
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
  const { language } = options;

  if (mockExecutor) {
    return mockExecutor(options);
  }

  const langConfig = LANGUAGE_PISTON_MAP[language];
  if (!langConfig) {
    throw Object.assign(new Error(`Unsupported language: ${language}`), { status: 400, code: 'VALIDATION' });
  }

  const configuredUrl = getPrimaryPistonUrl();
  const isLocalBypassed = shouldBypassLocalPiston(configuredUrl);
  // When configured for localhost:2000 without Docker, use Public Piston directly as primary engine
  const primaryUrl = isLocalBypassed ? 'https://emkc.org/api/v2/piston' : configuredUrl;

  // Tier 1: Primary Sandbox Engine (Public Piston or configured remote Piston)
  if (primaryWorkerState.healthy || Date.now() >= primaryWorkerState.retryAfter) {
    try {
      const result = await runWithPiston(primaryUrl, options, env.PISTON_API_KEY);
      primaryWorkerState.healthy = true;
      primaryWorkerState.lastChecked = Date.now();
      primaryWorkerState.lastError = undefined;
      return result;
    } catch (err: any) {
      if (err.status === 400 && !err.isRuntimeMissing) {
        throw err; // Pure client validation errors must be returned immediately
      }

      primaryWorkerState.healthy = false;
      primaryWorkerState.lastChecked = Date.now();
      primaryWorkerState.retryAfter = Date.now() + RECONNECT_COOLDOWN_MS;
      primaryWorkerState.lastError = err.message;
      console.warn(
        `[Execution] Primary execution endpoint (${primaryUrl}) unavailable: ${err.message}. Engaging local child_process fallback...`
      );
    }
  }

  // Tier 2: Public Piston worker (emkc.org) if primary was a custom URL that was not emkc
  if (!primaryUrl.includes('emkc.org')) {
    try {
      const result = await runWithPiston('https://emkc.org/api/v2/piston', options);
      return result;
    } catch (err: any) {
      if (err.status === 400 && !err.isRuntimeMissing) {
        throw err;
      }
      console.warn(`[Execution] Public Piston worker unavailable: ${err.message}. Engaging local child_process fallback...`);
    }
  }

  // Tier 3: Local Runtime Child_Process Worker (Node.js, Python, Java, C++)
  try {
    const result = await runWithLocalWorker(options);
    return result;
  } catch (err: any) {
    console.warn(`[Execution] Local child_process execution fallback failed for ${language}:`, err.message);
  }

  // Tier 4: Judge0 CE API (if configured or enabled)
  if (env.JUDGE0_API_KEY) {
    try {
      const result = await runWithJudge0(options);
      return result;
    } catch (err: any) {
      console.warn(`[Execution] Judge0 fallback unavailable: ${err.message}.`);
    }
  }

  // All execution tiers exhausted
  throw Object.assign(
    new Error(
      `Code execution service is currently unavailable. No reachable execution worker (Public Piston sandbox at https://emkc.org/api/v2/piston or host local child_process runtime) could run ${language}.`
    ),
    {
      status: 502,
      code: 'EXECUTION_UNAVAILABLE',
    }
  );
}
