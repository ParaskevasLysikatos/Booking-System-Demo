import { HttpErrorResponse } from '@angular/common/http';

import { parseApiErrors } from './api-errors';

const httpError = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('parseApiErrors', () => {
  it('maps DRF field errors', () => {
    const r = parseApiErrors(httpError(400, { password: ['Too common.', 'All numeric.'], email: ['Taken.'] }));
    expect(r.fields).toEqual({ password: ['Too common.', 'All numeric.'], email: ['Taken.'] });
    expect(r.general).toBeNull();
  });

  it('maps detail / non_field_errors to a general message and ignores `code`', () => {
    expect(parseApiErrors(httpError(401, { detail: 'No active account found with the given credentials' })).general)
      .toBe('No active account found with the given credentials');
    expect(parseApiErrors(httpError(409, { detail: 'Dates taken.', code: 'dates_unavailable' })).fields).toEqual({});
    expect(parseApiErrors(httpError(400, { non_field_errors: ['Bad.'] })).general).toBe('Bad.');
  });

  it('explains network and server failures', () => {
    expect(parseApiErrors(httpError(0, null)).general).toContain("Can't reach the server");
    expect(parseApiErrors(httpError(500, '<html>')).general).toContain('Server error');
    expect(parseApiErrors(new Error('x')).general).toContain('Something went wrong');
  });
});
