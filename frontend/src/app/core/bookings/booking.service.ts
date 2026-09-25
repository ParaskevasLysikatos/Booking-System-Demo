import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Paginated } from '../properties/property.models';
import { Booking, BookingListQuery, CreateBookingRequest } from './booking.models';

export const BOOKINGS_URL = `${environment.apiUrl}/bookings/`;

@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly http = inject(HttpClient);

  /**
   * Book a stay for the logged-in user. The server computes the price,
   * starts it as `pending`, and answers 409 if the dates were taken (even
   * by a simultaneous request - see the backend's exclusion constraint).
   */
  create(body: CreateBookingRequest): Observable<Booking> {
    return this.http.post<Booking>(BOOKINGS_URL, body);
  }

  get(id: number): Observable<Booking> {
    return this.http.get<Booking>(`${BOOKINGS_URL}${id}/`);
  }

  list(query: BookingListQuery = {}): Observable<Paginated<Booking>> {
    let params = new HttpParams();
    if (query.when) params = params.set('when', query.when);
    if (query.statuses?.length) params = params.set('status', query.statuses.join(','));
    if (query.mine) params = params.set('mine', 'true');
    if (query.search?.trim()) params = params.set('search', query.search.trim());
    if (query.property) params = params.set('property', query.property);
    if (query.page && query.page > 1) params = params.set('page', query.page);
    if (query.pageSize) params = params.set('page_size', query.pageSize);
    return this.http.get<Paginated<Booking>>(BOOKINGS_URL, { params });
  }

  /**
   * Cancel a booking. The server re-checks the rules against the locked
   * row (guests: only until 48h before check-in) and answers 400 with the
   * reason if it's no longer allowed.
   */
  cancel(id: number): Observable<Booking> {
    return this.http.patch<Booking>(`${BOOKINGS_URL}${id}/`, { status: 'cancelled' });
  }

  /** Admin: pending -> confirmed (the backend's transition table decides; 400 with a reason otherwise). */
  confirm(id: number): Observable<Booking> {
    return this.http.patch<Booking>(`${BOOKINGS_URL}${id}/`, { status: 'confirmed' });
  }
}
