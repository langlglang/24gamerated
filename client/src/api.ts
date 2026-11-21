/**
 * Thin REST layer. Same-origin, so no base URL is needed: Vite proxies /api to
 * the server in dev and the server serves the client in production.
 */

const TOKEN_KEY = '24game.token';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private-mode browsers: the session just will not survive a refresh.
  }
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string; status: number };

async function request<T>(
  path: string,
  init: RequestInit,
  token?: string | null,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    const text = await response.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: String(body['error'] ?? 'Something went wrong.'),
        field: typeof body['field'] === 'string' ? body['field'] : undefined,
      };
    }
    return { ok: true, data: body as T };
  } catch {
    // Network failure, or the server is not running.
    return { ok: false, status: 0, error: 'Could not reach the server.' };
  }
}

export function apiGet<T>(path: string, token?: string | null): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'GET' }, token);
}

export function apiPost<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) }, token);
}
