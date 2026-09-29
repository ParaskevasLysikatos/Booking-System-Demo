import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { Booking } from '../../core/bookings/booking.models';
import { formatPrice } from '../../core/money';
import { formatDate } from '../../core/i18n/format';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** "Cancel your stay at …?" - closes with `true` to cancel, anything else keeps it. */
@Component({
  selector: 'app-cancel-booking-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'myBookings.dialog.title' | t }}</h2>
    <mat-dialog-content>
      <p>
        {{ 'myBookings.dialog.stayAt' | t }} <strong>{{ b.property.title }}</strong>{{
          'myBookings.dialog.willCancel' | t: { from: date(b.check_in), to: date(b.check_out), nights: ('common.nights' | t: { count: b.nights }), total }
        }}
      </p>
      <p class="muted">
        <mat-icon>info</mat-icon>
        <span>{{ 'myBookings.dialog.final' | t }}
          @switch (b.payment?.status) {
            @case ('paid') { <span [innerHTML]="'myBookings.dialog.paid' | t: { amount: paid }"></span> }
            @case ('open') { {{ 'myBookings.dialog.open' | t }} }
            @default { {{ 'myBookings.dialog.nothing' | t }} }
          }
        </span>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false" cdkFocusInitial>{{ 'myBookings.dialog.keep' | t }}</button>
      <button mat-flat-button class="danger" [mat-dialog-close]="true">{{ 'myBookings.cancel' | t }}</button>
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
  // Getters, not fields: formatPrice follows the language (TICKET-038).
  get total(): string {
    return formatPrice(this.b.total_price);
  }
  get paid(): string {
    return formatPrice(this.b.payment?.amount ?? this.b.total_price);
  }

  date(iso: string): string {
    return formatDate(iso, 'medium');
  }
}
