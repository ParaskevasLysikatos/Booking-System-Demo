import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { formatDeadline, GUEST_CANCELLATION_HOURS } from '../core/bookings/booking-policy';
import { Booking } from '../core/bookings/booking.models';
import { parseIsoDate } from '../core/dates';
import { formatPrice } from '../core/money';

/**
 * The booking summary card shown after booking - on the booking form's
 * confirmation screen (payments off) and on the payment return page
 * (TICKET-029), so both look the same. Everything comes from the server's
 * response, including the authoritative cancellation deadline.
 */
@Component({
  selector: 'app-booking-summary',
  imports: [MatIconModule],
  template: `
    @let b = booking();
    <div class="summary">
      <h2>{{ b.property.title }}</h2>
      <p class="muted">{{ b.property.location }}</p>
      <dl>
        <div><dt>Check-in</dt><dd>{{ date(b.check_in) }} · from 15:00</dd></div>
        <div><dt>Check-out</dt><dd>{{ date(b.check_out) }}</dd></div>
        <div><dt>Guests</dt><dd>{{ b.guests }}</dd></div>
        <div><dt>Nights</dt><dd>{{ b.nights }}</dd></div>
        <div class="sum"><dt>{{ paid() ? 'Paid' : 'Total' }}</dt><dd>{{ total() }}</dd></div>
      </dl>
      <p class="policy">
        <mat-icon>event_available</mat-icon>
        <span>
          @if (b.can_cancel) {
            Free cancellation until <strong>{{ deadline() }}</strong>{{ paid() ? ' - full refund.' : '.' }}
          } @else {
            Check-in is less than {{ hours }} hours away, so this booking can't be cancelled online.
          }
        </span>
      </p>
    </div>
  `,
  styles: `
    .summary { border: 1px solid var(--mat-sys-outline-variant); border-radius: 16px; padding: 16px; text-align: left; }
    h2 { margin: 0 0 4px; font-size: 18px; font-weight: 500; }
    .muted { margin: 0; color: var(--mat-sys-on-surface-variant); }
    dl { margin: 8px 0 0; }
    dl div { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; }
    dt { color: var(--mat-sys-on-surface-variant); }
    dd { margin: 0; text-align: right; }
    .sum { border-top: 1px solid var(--mat-sys-outline-variant); margin-top: 4px; padding-top: 8px; font-weight: 500; }
    .policy { display: flex; align-items: flex-start; gap: 6px; margin: 16px 0 0; font-size: 14px; color: var(--mat-sys-on-surface-variant); }
    .policy mat-icon { flex-shrink: 0; font-size: 18px; width: 18px; height: 18px; }
  `,
})
export class BookingSummary {
  readonly booking = input.required<Booking>();
  readonly hours = GUEST_CANCELLATION_HOURS;

  readonly paid = computed(() => this.booking().payment?.status === 'paid');
  readonly total = computed(() => formatPrice(this.booking().payment?.amount ?? this.booking().total_price));
  readonly deadline = computed(() => formatDeadline(new Date(this.booking().cancel_deadline)));

  date(iso: string): string {
    return parseIsoDate(iso)!.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
}
