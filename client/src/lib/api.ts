import { supabase } from './supabase';
import { ApiErrorResponse } from '@linkup/shared';

// Support VITE_API_BASE_URL, VITE_API_URL, and typo fallback VITE_APL_URL.
// When none are set, requests use relative URLs in local dev (e.g. /api/me) which Vite's dev-server
// proxy forwards to localhost:3001. In production on Render, fallback to the LinkUp backend URL.
const RAW_API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_APL_URL ||
  (typeof window !== 'undefined' && window.location.hostname.includes('linkup-collaborative-workspace')
    ? 'https://linkup-collaborative-workspace-r74x.onrender.com'
    : '')
).trim();

export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, '');

export class HttpError extends Error {
  public status: number;
  public code: string;
  public details?: unknown;
  public data?: any;

  constructor(status: number, code: string, message?: string, details?: unknown, data?: any) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.data = data;
  }
}

/**
 * NetworkError is thrown when the server is unreachable (fetch throws TypeError)
 * as opposed to an HttpError where the server responded with an error status code.
 */
export class NetworkError extends Error {
  public readonly isNetworkError = true;
  constructor(message?: string) {
    super(
      message ||
        'Network request failed — the server may be unreachable. ' +
          'Please ensure the backend is running (npm run dev:server).'
    );
    this.name = 'NetworkError';
  }
}

/** Sleep helper for retry back-off */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper that automatically adds the Supabase access token as Bearer token
 * and implements Acceptance Criterion 3:
 * "An expired token returns 401; the client silently refreshes the token and retries."
 *
 * Supports exponential backoff retry for transient network failures and 5xx server errors.
 * Retries: up to 2 times, with 500ms and 1500ms delays.
 *
 * @throws {NetworkError} when the server is completely unreachable after all retries
 * @throws {HttpError}    for 4xx / 5xx responses after retries are exhausted
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  retries = 2
): Promise<Response> {
  const url =
    endpoint.startsWith('http://') || endpoint.startsWith('https://')
      ? endpoint
      : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  // 1. Get current Supabase session token
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Exponential back-off: 0ms → 500ms → 1500ms
    if (attempt > 0) {
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 4000);
      console.info(`[apiFetch] Retry ${attempt}/${retries} for "${url}" after ${delay}ms…`);
      await sleep(delay);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (fetchErr: any) {
      // Network-level failure (server down, DNS, CORS preflight rejected by missing server)
      lastError = new NetworkError(
        `Cannot reach the server at "${url}". ` +
          `Make sure the backend is running (npm run dev:server) and that port 3001 is not blocked.`
      );
      console.warn(`[apiFetch] Network error on attempt ${attempt + 1}/${retries + 1}:`, fetchErr?.message);
      continue; // retry
    }

    // 2. Acceptance Criterion 3: If 401 UNAUTHENTICATED on first attempt, silently refresh token
    if (response.status === 401 && attempt === 0) {
      try {
        console.warn('[apiFetch] Received 401 — attempting silent token refresh…');
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

        if (!refreshError && refreshData.session?.access_token) {
          const newToken = refreshData.session.access_token;
          const retryHeaders = new Headers(headers);
          retryHeaders.set('Authorization', `Bearer ${newToken}`);
          console.info('[apiFetch] Token refreshed. Retrying request…');
          return await fetch(url, { ...options, headers: retryHeaders });
        } else {
          console.warn('[apiFetch] Silent token refresh failed:', refreshError?.message);
        }
      } catch (refreshErr) {
        console.error('[apiFetch] Error during silent token refresh:', refreshErr);
      }
      return response; // Return the original 401 if refresh failed
    }

    // 3. Retry 5xx server errors (transient backend failures) — but not 4xx client errors
    if (response.status >= 500 && attempt < retries) {
      lastError = new HttpError(response.status, 'SERVER_ERROR', `Server error ${response.status}`);
      console.warn(`[apiFetch] Server returned ${response.status} on attempt ${attempt + 1}, retrying…`);
      continue;
    }

    // Success or non-retriable client error (4xx)
    return response;
  }

  // All retries exhausted
  if (lastError) throw lastError;
  throw new NetworkError();
}

/**
 * Type-safe API client helpers mapped to standard LinkUp error format
 */
export const api = {
  async get<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
    const res = await apiFetch(endpoint, { ...options, method: 'GET' });
    return handleResponse<T>(res);
  },

  async post<T = unknown>(endpoint: string, body?: unknown, options?: RequestInit): Promise<T> {
    const res = await apiFetch(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async patch<T = unknown>(endpoint: string, body?: unknown, options?: RequestInit): Promise<T> {
    const res = await apiFetch(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async delete<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
    const res = await apiFetch(endpoint, { ...options, method: 'DELETE' });
    return handleResponse<T>(res);
  },
};

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorData: ApiErrorResponse | null = null;
    try {
      errorData = (await res.json()) as ApiErrorResponse;
    } catch {
      // not JSON
    }

    const code =
      (typeof (errorData as any)?.error === 'string'
        ? (errorData as any).error
        : errorData?.error?.code) ||
      (errorData as any)?.code ||
      (res.status === 401 ? 'UNAUTHENTICATED' : 'UNKNOWN_ERROR');
    const message =
      (typeof errorData?.error === 'object'
        ? errorData?.error?.message
        : (errorData as any)?.message) || res.statusText;
    const details = typeof errorData?.error === 'object' ? errorData?.error?.details : undefined;

    throw new HttpError(res.status, code, message, details, errorData);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return null as T;
}
