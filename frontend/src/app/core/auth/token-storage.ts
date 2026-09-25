import { Injectable } from '@angular/core';

import { AuthUser } from './auth.models';

const ACCESS_KEY = 'bsd.access';
const REFRESH_KEY = 'bsd.refresh';
const USER_KEY = 'bsd.user';

/**
 * Where the session lives between page reloads: localStorage (agreed for
 * TICKET-017 - keeps the demo logged in across reloads and tabs until the
 * 1-day refresh token expires).
 *
 * Every access is wrapped in try/catch: storage can be unavailable
 * (private mode, blocked site data) and the app must still work - it just
 * won't remember the session.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  getAccess(): string | null {
    return this.read(ACCESS_KEY);
  }

  getRefresh(): string | null {
    return this.read(REFRESH_KEY);
  }

  getUser(): AuthUser | null {
    const raw = this.read(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  setTokens(access: string, refresh?: string): void {
    this.write(ACCESS_KEY, access);
    if (refresh) this.write(REFRESH_KEY, refresh);
  }

  setUser(user: AuthUser): void {
    this.write(USER_KEY, JSON.stringify(user));
  }

  clear(): void {
    for (const key of [ACCESS_KEY, REFRESH_KEY, USER_KEY]) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* storage unavailable - nothing to clear */
      }
    }
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable/full - session just won't survive a reload */
    }
  }
}
