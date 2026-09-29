import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { CHECK_IN_HOUR, formatDeadline, GUEST_CANCELLATION_HOURS } from '../core/bookings/booking-policy';
import { Booking } from '../core/bookings/booking.models';
import { formatPrice } from '../core/money';
import { formatDate } from '../core/i18n/format';
import { TranslatePipe } from '../core/i18n/translate.pipe';

/**
 * The booking summary card shown after booking - on the booking form's
 * confirmation screen (payments off) and on the payment return page
 * (TICKET-029), so both look the same. Everything comes from the server's
 * response, including the authoritative cancellation deadline.
 */
@Component({
  selector: 'app-booking-summary',
  imports: [MatIconModule, TranslatePipe],
  template: `
    @let b = booking();
    <div class="summary">
      <h2>{{ b.property.title }}</h2>
      <p class="muted">{{ b.property.location }}</p>
      <dl>
        <div><dt>{{ 'common.checkIn' | t }}</dt><dd>{{ 'booking.fromTime' | t: { date: date(b.check_in), time: checkInTime } }}</dd></div>
        <div><dt>{{ 'common.checkOut' | t }}</dt><dd>{{ date(b.check_out) }}</dd></div>
        <div><dt>{{ 'listings.guests' | t }}</dt><dd>{{ b.guests }}</dd></div>
        <div><dt>{{ 'booking.nights' | t }}</dt><dd>{{ b.nights }}</dd></div>
        <div class="sum"><dt>{{ (paid() ? 'booking.summary.paid' : 'detail.total') | t }}</dt><dd>{{ total() }}</dd></div>
      </dl>
      <!-- The cancellation policy only means something while the booking is
           still active (found in the TICKET-029 end-to-end run: a cancelled
           booking used to say "can't be cancelled online"). -->
      @if (b.status !== 'cancelled') {
        <p class="policy">
          <mat-icon>event_available</mat-icon>
          <span>
            @if (b.can_cancel) {
              <span [innerHTML]="'booking.summary.freeCancel' | t: { deadline: deadline(), refund: ((paid() ? 'booking.summary.refundEnd' : 'booking.summary.end') | t) }"></span>
            } @else {
              {{ 'booking.summary.tooLate' | t: { hours } }}
            }
          </span>
        </p>
      }
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
  readonly checkInTime = `${CHECK_IN_HOUR}:00`;

  readonly paid = computed(() => this.booking().payment?.status === 'paid');
  readonly total = computed(() => formatPrice(this.booking().payment?.amount ?? this.booking().total_price));
  readonly deadline = computed(() => formatDeadline(new Date(this.booking().cancel_deadline)));

  date(iso: string): string {
    return formatDate(iso, 'full');
  }
}
