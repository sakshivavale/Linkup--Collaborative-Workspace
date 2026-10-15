import { supabase } from './supabase';
import { ApiErrorResponse } from '@linkup/shared';

// When VITE_API_BASE_URL is empty (default), requests use relative URLs
// (e.g. /api/me) which Vite's dev-server proxy forwards to localhost:3001.
// This permanently removes the need to hardcode any IP address.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

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
 * Fetch wrapper that automatically adds the Supabase access token as Bearer token
 * and implements Acceptance Criterion 3:
 * "An expired token returns 401; the client silently refreshes the token and retries."
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = endpoint.startsWith('http://') || endpoint.startsWith('https://')
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

  const initialResponse = await fetch(url, {
    ...options,
    headers,
  });

  // 2. Acceptance Criterion 3: If 401 UNAUTHENTICATED, silently refresh and retry once
  if (initialResponse.status === 401) {
    try {
      console.warn('[apiFetch] Received 401 from server. Attempting silent token refresh...');
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

      if (!refreshError && refreshData.session?.access_token) {
        const newToken = refreshData.session.access_token;
        const retryHeaders = new Headers(headers);
        retryHeaders.set('Authorization', `Bearer ${newToken}`);

        console.info('[apiFetch] Token refreshed successfully. Retrying request...');
        return await fetch(url, {
          ...options,
          headers: retryHeaders,
        });
      } else {
        console.warn('[apiFetch] Silent token refresh failed:', refreshError?.message);
      }
    } catch (refreshErr) {
      console.error('[apiFetch] Unexpected error during silent token refresh:', refreshErr);
    }
  }

  return initialResponse;
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

    const code = errorData?.error?.code || (res.status === 401 ? 'UNAUTHENTICATED' : 'UNKNOWN_ERROR');
    const message = errorData?.error?.message || res.statusText;
    const details = errorData?.error?.details;

    throw new HttpError(res.status, code, message, details, errorData);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return null as T;
}
