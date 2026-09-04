/** Thin client over the API's single error envelope. */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError('OFFLINE', 'Could not reach the server. Check your connection.', 0);
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: { code: string; message: string; details?: unknown } }
    | null;

  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `Request failed (${response.status}).`,
      response.status,
      body?.error?.details,
    );
  }
  return body as T;
}

export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });

export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });

export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
