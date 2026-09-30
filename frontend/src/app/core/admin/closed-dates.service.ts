import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

/** One closed period of a property (TICKET-045, backend listings/blocks.py). */
export interface ClosedPeriod {
  id: number;
  property: number;
  start: string; // YYYY-MM-DD, the first closed night
  end: string; // YYYY-MM-DD, exclusive - the day it opens again (like a check-out)
  nights: number;
  note: string;
  created_by: string | null; // the admin's email
  created_at: string;
}

export interface ClosePeriodBody {
  start: string;
  end: string;
  note: string;
}

export const adminBlocksUrl = (propertyId: number) => `${environment.apiUrl}/admin/properties/${propertyId}/blocks/`;

/**
 * Closed dates of a property (TICKET-045), admins only:
 * GET (upcoming, soonest first) / POST (close) / DELETE (reopen).
 * A 409 means the dates overlap a booking (`booking_overlap`) or closed
 * dates (`dates_closed`) - its `detail` says which, in the app's language.
 */
@Injectable({ providedIn: 'root' })
export class ClosedDatesService {
  private readonly http = inject(HttpClient);

  list(propertyId: number): Observable<ClosedPeriod[]> {
    return this.http.get<ClosedPeriod[]>(adminBlocksUrl(propertyId));
  }

  close(propertyId: number, body: ClosePeriodBody): Observable<ClosedPeriod> {
    return this.http.post<ClosedPeriod>(adminBlocksUrl(propertyId), body);
  }

  reopen(propertyId: number, blockId: number): Observable<void> {
    return this.http.delete<void>(`${adminBlocksUrl(propertyId)}${blockId}/`);
  }
}
