/** Build an unsigned JWT-shaped string with the given payload (tests only). */
export function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj)); // UTF-8, like a real JWT
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

/** A token expiring `secondsFromNow` seconds from now. */
export function tokenExpiringIn(secondsFromNow: number, extra: Record<string, unknown> = {}): string {
  return fakeJwt({ exp: Math.floor(Date.now() / 1000) + secondsFromNow, ...extra });
}
