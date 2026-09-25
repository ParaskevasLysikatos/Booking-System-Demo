import { decodeJwt, isTokenExpired } from './jwt';
import { fakeJwt, tokenExpiringIn } from '../../testing/fake-jwt';

describe('jwt helpers', () => {
  it('decodes the payload (base64url, unicode)', () => {
    const token = fakeJwt({ exp: 123, email: 'mαria@example.com', role: 'guest' });
    expect(decodeJwt(token)).toEqual({ exp: 123, email: 'mαria@example.com', role: 'guest' });
  });

  it('returns null for garbage', () => {
    expect(decodeJwt(null)).toBeNull();
    expect(decodeJwt('not-a-jwt')).toBeNull();
    expect(decodeJwt('a.%%%.c')).toBeNull();
  });

  it('knows when a token is expired (with skew)', () => {
    expect(isTokenExpired(tokenExpiringIn(3600))).toBe(false);
    expect(isTokenExpired(tokenExpiringIn(-5))).toBe(true);
    expect(isTokenExpired(tokenExpiringIn(5), 10)).toBe(true); // within the skew window
    expect(isTokenExpired(tokenExpiringIn(5), 0)).toBe(false);
    expect(isTokenExpired('garbage')).toBe(true);
  });
});
