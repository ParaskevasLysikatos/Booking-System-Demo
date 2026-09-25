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
