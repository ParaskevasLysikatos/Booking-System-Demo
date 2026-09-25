/**
 * Minimal JWT payload reader - just enough to know when a token expires.
 * No signature check (that's the server's job); no npm dependency.
 */

export interface JwtPayload {
  exp?: number; // seconds since epoch
  user_id?: number | string;
  email?: string;
  role?: string;
  token_type?: 'access' | 'refresh';
}

export function decodeJwt(token: string | null | undefined): JwtPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** True if the token is missing, unreadable, or expires within `skewSeconds`. */
export function isTokenExpired(token: string | null | undefined, skewSeconds = 10, now = Date.now()): boolean {
  const exp = decodeJwt(token)?.exp;
  if (!exp) return true;
  return exp * 1000 <= now + skewSeconds * 1000;
}
