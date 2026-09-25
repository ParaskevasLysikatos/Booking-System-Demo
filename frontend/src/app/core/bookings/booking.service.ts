import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Booking, CreateBookingRequest } from './booking.models';

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
}
