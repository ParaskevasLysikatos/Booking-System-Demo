import { HttpClient, HttpParams } from '@angular/common/http';
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

/** GET /api/admin/blocks/ - the list across properties (step 4). */
export interface ClosedPeriodWithProperty extends ClosedPeriod {
  property_title: string;
  property_is_active: boolean;
}

export interface ClosePeriodBody {
  start: string;
  end: string;
  note: string;
}

export const adminBlocksUrl = (propertyId: number) => `${environment.apiUrl}/admin/properties/${propertyId}/blocks/`;
export const ALL_BLOCKS_URL = `${environment.apiUrl}/admin/blocks/`;

/**
 * Closed dates of a property (TICKET-045), admins only:
 * GET (upcoming, soonest first) / POST (close) / DELETE (reopen).
 * A 409 means the dates overlap a booking (`booking_overlap`) or closed
 * dates (`dates_closed`) - its `detail` says which, in the app's language.
 */
@Injectable({ providedIn: 'root' })
export class ClosedDatesService {
  private readonly http = inject(HttpClient);

  /** Every property's upcoming closed dates, soonest first; `property` narrows it to one. */
  listAll(property: number | null = null): Observable<ClosedPeriodWithProperty[]> {
    const params = property ? new HttpParams().set('property', property) : undefined;
    return this.http.get<ClosedPeriodWithProperty[]>(ALL_BLOCKS_URL, { params });
  }

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
