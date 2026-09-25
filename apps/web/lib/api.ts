// api.ts is the one place the web app talks to the API.
//
// Requests go to this app's own origin and Next proxies them (next.config.mjs),
// so the httpOnly cookies the API sets are same-site and travel automatically.
// No token is ever held in JavaScript.
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * True when the tenant may read but not write — an unpaid or lapsed
   * subscription, rather than a permission they lack.
   */
  get readOnly(): boolean {
    return this.status === 403 && (this.body as { readOnly?: boolean })?.readOnly === true;
  }

  /**
   * True when the tenant hit a plan limit rather than doing anything wrong.
   * The body carries the metric, the limit and where to upgrade.
   */
  get planLimit(): { metric: string; limit: number; current: number } | null {
    if (this.status !== 402) return null;
    const b = this.body as { metric?: string; limit?: number; current?: number };
    return b?.metric
      ? { metric: b.metric, limit: b.limit ?? 0, current: b.current ?? 0 }
      : null;
  }

  /** True when the server rejected the input and named the fields. */
  get fieldErrors(): Record<string, string[]> | null {
    const b = this.body as { errors?: { fieldErrors?: Record<string, string[]> } };
    return b?.errors?.fieldErrors ?? null;
  }
}

type Options = RequestInit & { idempotencyKey?: string };

/**
 * A single in-flight refresh, shared by every caller.
 *
 * Without this, three requests hitting a just-expired token would each try to
 * refresh, and the two that lost the race would be handed a rotated session id
 * that no longer exists.
 */
let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}

async function request<T>(
  path: string,
  options: Options = {},
  retryOn401 = true,
): Promise<T> {
  const { idempotencyKey, ...init } = options;

  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  // The access token lasts 15 minutes, so an expired one is ordinary, not an
  // error worth showing. Refresh once and replay.
  if (response.status === 401 && retryOn401 && !path.startsWith('/auth/')) {
    if (await refresh()) return request<T>(path, options, false);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = text ? safeParse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageOf(body) ?? `Request failed (${response.status})`,
      body,
    );
  }

  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageOf(body: unknown): string | null {
  const m = (body as { message?: string | string[] })?.message;
  if (Array.isArray(m)) return m.join(', ');
  return typeof m === 'string' ? m : null;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      idempotencyKey,
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
