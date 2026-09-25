import { Injectable, inject, signal } from '@angular/core';

import { BookingService } from '../bookings/booking.service';

/**
 * Counts shown as badges in the admin side nav (TICKET-025): upcoming
 * bookings still waiting for confirmation. Refreshed when the admin area
 * opens and after every booking action.
 */
@Injectable({ providedIn: 'root' })
export class AdminBadgesService {
  private readonly bookings = inject(BookingService);

  readonly pendingBookings = signal<number | null>(null);

  refresh(): void {
    this.bookings.list({ when: 'upcoming', statuses: ['pending'], pageSize: 1 }).subscribe({
      next: (page) => this.pendingBookings.set(page.count),
      error: () => {
        /* a badge is a nice-to-have - keep the last known value */
      },
    });
  }
}
