import { HttpErrorResponse } from '@angular/common/http';
import { translate } from './i18n/translation.service';

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
    result.general = translate('errors.generic');
    return result;
  }
  if (err.status === 0) {
    result.general = translate('errors.offline');
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
    result.general = translate(err.status >= 500 ? 'errors.server' : 'errors.request');
  }
  return result;
}
