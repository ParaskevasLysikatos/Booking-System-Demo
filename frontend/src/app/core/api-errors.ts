import { HttpErrorResponse } from '@angular/common/http';

export interface ApiErrors {
  /** Per-field messages, keyed by the API's field name (e.g. `first_name`). */
  fields: Record<string, string[]>;
  /** A message not tied to a field (DRF `detail` / `non_field_errors`, network errors). */
  general: string | null;
}

/**
 * Turn a DRF error response into something a form can show:
 * `{"password": ["This password is too common."]}` -> fields.password,
 * `{"detail": "No active account ..."}` -> general.
 */
export function parseApiErrors(err: unknown): ApiErrors {
  const result: ApiErrors = { fields: {}, general: null };
  if (!(err instanceof HttpErrorResponse)) {
    result.general = 'Something went wrong. Please try again.';
    return result;
  }
  if (err.status === 0) {
    result.general = "Can't reach the server. Check your connection and try again.";
    return result;
  }
  const body = err.error;
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      const messages = Array.isArray(value) ? value.map(String) : [String(value)];
      if (key === 'detail' || key === 'non_field_errors') {
        result.general = messages.join(' ');
      } else if (key !== 'code') {
        result.fields[key] = messages;
      }
    }
  }
  if (!result.general && Object.keys(result.fields).length === 0) {
    result.general = err.status >= 500 ? 'Server error. Please try again in a moment.' : 'Request failed.';
  }
  return result;
}
