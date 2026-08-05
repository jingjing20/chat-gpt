import { errorResponseSchema } from '@chat/contracts';

const API_BASE_URL = '/api/v1';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiRequest(
  path: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method)) {
    const csrfToken = readCookie('chat_csrf');
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (response.status === 401 && allowRefresh && !path.startsWith('/auth/')) {
    await refreshSession();
    return apiRequest(path, init, false);
  }
  if (!response.ok) {
    const payload = errorResponseSchema.safeParse(await safeJson(response));
    throw new ApiClientError(
      response.status,
      payload.success ? payload.data.code : 'REQUEST_FAILED',
      payload.success ? payload.data.message : '请求失败，请稍后重试',
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}

export async function obtainCsrf(): Promise<void> {
  await apiRequest('/auth/csrf', { method: 'GET' }, false);
}

async function refreshSession(): Promise<void> {
  await apiRequest('/auth/refresh', { method: 'POST' }, false);
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
