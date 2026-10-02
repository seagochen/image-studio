export interface ApiResult<T> { ok: boolean; status: number; data: T | null }

export async function api<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, init);
    let data: T | null = null;
    try { data = await response.json() as T; } catch { /* Empty responses are valid at this layer. */ }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
