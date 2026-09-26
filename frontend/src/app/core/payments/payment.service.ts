import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, shareReplay } from 'rxjs';

import { environment } from '../../../environments/environment';
import { BOOKINGS_URL } from '../bookings/booking.service';
import { CheckoutResponse, PAYMENTS_OFF, PaymentsConfig } from './payment.models';

export const PAYMENTS_URL = `${environment.apiUrl}/payments/`;

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private cached: Observable<PaymentsConfig> | null = null;

  /**
   * Whether online payment is on (and the hold length) - only used for
   * wording *before* a booking exists. Loaded once; a failed load counts as
   * "off" but isn't cached, so the next page tries again. What actually
   * happens after booking is decided by the booking's own `payment` block.
   */
  config(): Observable<PaymentsConfig> {
    this.cached ??= this.http.get<PaymentsConfig>(`${PAYMENTS_URL}config/`).pipe(shareReplay(1));
    return this.cached.pipe(
      catchError(() => {
        this.cached = null;
        return of(PAYMENTS_OFF);
      }),
    );
  }

  /**
   * Stripe's hosted payment page for one of the caller's own bookings. Safe
   * to repeat: the server returns the same page until the hold runs out.
   */
  checkout(bookingId: number): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`${BOOKINGS_URL}${bookingId}/checkout/`, {});
  }
}
