const AUTHENTICATED_ROOTS = ["/dashboard", "/apps/ai-lab", "/apps/image-studio", "/apps/annotation", "/account"];

export function safeAuthenticatedPath(value: string, fallback = "/dashboard"): string {
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, window.location.origin);
    const allowed = parsed.origin === window.location.origin && AUTHENTICATED_ROOTS.some(
      (root) => parsed.pathname === root || parsed.pathname.startsWith(`${root}/`),
    );
    return allowed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function loginPath(next: string): string {
  return `/account?next=${encodeURIComponent(safeAuthenticatedPath(next))}`;
}
