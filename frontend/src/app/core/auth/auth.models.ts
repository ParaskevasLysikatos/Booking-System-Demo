/** Shapes returned by the Django auth API (backend/accounts/serializers.py). */

export type Role = 'guest' | 'admin';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  phone: string;
  is_admin: boolean;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

/** POST /api/auth/login/ and /api/auth/register/ both return this. */
export interface AuthResponse extends TokenPair {
  user: AuthUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/**
 * One entry of GET /api/auth/demo-logins/ (TICKET-041): a seeded demo login
 * the login page offers to fill in. Only listed while that account exists
 * and still has the seeded password (backend/core/demo_accounts.py).
 */
export interface DemoLogin {
  role: Role;
  email: string;
  password: string;
  /** Guests only: how many demo guests there are, and the last one's email. */
  count?: number;
  last_email?: string;
}
