import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { Booking } from '../../core/bookings/booking.models';
import { parseIsoDate } from '../../core/dates';
import { formatPrice } from '../../core/money';

/** "Cancel your stay at …?" - closes with `true` to cancel, anything else keeps it. */
@Component({
  selector: 'app-cancel-booking-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Cancel this booking?</h2>
    <mat-dialog-content>
      <p>
        Your stay at <strong>{{ b.property.title }}</strong>,
        {{ date(b.check_in) }} – {{ date(b.check_out) }} ({{ b.nights }} {{ b.nights === 1 ? 'night' : 'nights' }},
        {{ total }}), will be cancelled and the dates released.
      </p>
      <p class="muted">
        <mat-icon>info</mat-icon>
        <span>This can't be undone - to go back you'd need to book again (if the dates are still free).
          Payments aren't taken yet, so there's nothing to refund.</span>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false" cdkFocusInitial>Keep booking</button>
      <button mat-flat-button class="danger" [mat-dialog-close]="true">Cancel booking</button>
    </mat-dialog-actions>
  `,
  styles: `
    .muted { display: flex; gap: 8px; align-items: flex-start; color: var(--mat-sys-on-surface-variant); font-size: 14px; }
    .muted mat-icon { flex-shrink: 0; font-size: 18px; width: 18px; height: 18px; }
    .danger { background: var(--mat-sys-error); color: var(--mat-sys-on-error); }
  `,
})
export class CancelBookingDialog {
  readonly b = inject<Booking>(MAT_DIALOG_DATA);
  readonly total = formatPrice(this.b.total_price);

  date(iso: string): string {
    return parseIsoDate(iso)!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
