import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { parseApiErrors } from '../../core/api-errors';
import { Booking } from '../../core/bookings/booking.models';
import { BookingService } from '../../core/bookings/booking.service';
import { parseIsoDate, todayLocal } from '../../core/dates';
import { formatPrice } from '../../core/money';
import { BrowserRedirect } from '../../core/payments/browser-redirect';
import { clockSignal, clockTime, formatRemaining, remainingMs } from '../../core/payments/countdown';
import { PaymentService } from '../../core/payments/payment.service';
import { BookingSummary } from '../../shared/booking-summary';
import { CancelBookingDialog } from '../my-bookings/cancel-dialog';

/** How long "Confirming your payment…" waits for the webhook: every 2 s, 15 times (30 s). */
export const POLL_EVERY_MS = 2000;
export const POLL_TIMES = 15;

export type ReturnPhase =
  | 'loading'
  | 'confirming' // back from Stripe after paying; waiting for the webhook
  | 'confirmed' // paid (or confirmed by the host)
  | 'processing' // a delayed payment method, the bank hasn't finished
  | 'not_yet' // paid, but no confirmation from Stripe after 30 s
  | 'unpaid' // came back without paying; the hold is still running
  | 'timed_out' // the hold ran out (the booking is being released)
  | 'released' // payment expired / failed: booking cancelled, dates free
  | 'cancelled' // booking cancelled (by the guest or the host)
  | 'not_found'
  | 'error';

/**
 * /bookings/:id/payment (TICKET-029) - where Stripe sends the guest back.
 * `?session_id=...` = they finished paying; `?cancelled=1` = they backed out.
 *
 * The page never decides that a payment worked: only the booking the API
 * returns does (confirmed by Stripe's webhook). So after paying it shows
 * "Confirming your payment…" and re-reads the booking every 2 seconds.
 */
@Component({
  selector: 'app-payment-return',
  imports: [BookingSummary, MatButtonModule, MatIconModule, MatProgressSpinnerModule, RouterLink],
  templateUrl: './payment-return.html',
  styleUrl: './payment-return.scss',
})
export class PaymentReturnPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bookings = inject(BookingService);
  private readonly payments = inject(PaymentService);
  private readonly redirect = inject(BrowserRedirect);
  private readonly dialog = inject(MatDialog);
  private readonly titleService = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = Number(this.route.snapshot.paramMap.get('id'));
  /** Stripe's success_url adds ?session_id=... - the guest went through with paying. */
  readonly returnedAfterPaying = this.route.snapshot.queryParamMap.has('session_id');

  readonly booking = signal<Booking | null>(null);
  private readonly phase = signal<ReturnPhase>('loading');
  readonly busy = signal<'pay' | 'cancel' | null>(null);
  readonly actionError = signal<string | null>(null);

  private readonly clock = clockSignal();
  readonly remaining = computed(() => remainingMs(this.booking()?.payment?.expires_at, this.clock()));
  readonly remainingText = computed(() => formatRemaining(this.remaining()));

  /** What to show: an unpaid hold whose countdown reaches 0 turns into "time ran out" on the spot. */
  readonly view = computed<ReturnPhase>(() => {
    const phase = this.phase();
    return phase === 'unpaid' && this.remaining() === 0 ? 'timed_out' : phase;
  });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly formatPrice = formatPrice;
  readonly clockTime = clockTime;

  constructor() {
    this.titleService.setTitle('Payment · Booking System Demo');
    if (!Number.isInteger(this.id) || this.id <= 0) {
      void this.router.navigateByUrl('/my-bookings');
      return;
    }
    this.destroyRef.onDestroy(() => this.stopPolling());
    this.load();
  }

  /** (Re)load the booking and decide what to show. */
  load(): void {
    this.bookings.get(this.id).subscribe({
      next: (b) => this.show(b, true),
      error: (err) => this.phase.set(err instanceof HttpErrorResponse && err.status === 404 ? 'not_found' : 'error'),
    });
  }

  private show(b: Booking, first: boolean): void {
    this.booking.set(b);
    if (!b.payment) {
      // Doesn't take online payment - nothing to do here.
      void this.router.navigate(['/my-bookings'], { replaceUrl: true });
      return;
    }
    const phase = phaseFor(b, this.returnedAfterPaying);
    this.phase.set(phase);
    this.titleService.setTitle(`${TITLES[phase] ?? 'Payment'} · Booking System Demo`);
    if (phase === 'confirming' && first) this.poll();
  }

  /**
   * Re-read the booking every 2 s until the webhook has settled it, or give
   * up after 15 tries (30 s). One request at a time: the next one is only
   * scheduled once the previous answer is in.
   */
  private poll(attempt = 1): void {
    this.stopPolling();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.bookings.get(this.id).subscribe({
        next: (b) => {
          if (phaseFor(b, true) !== 'confirming') {
            this.show(b, false);
          } else if (attempt < POLL_TIMES) {
            this.booking.set(b);
            this.poll(attempt + 1);
          } else {
            this.booking.set(b);
            this.giveUpWaiting();
          }
        },
        error: () => (attempt < POLL_TIMES ? this.poll(attempt + 1) : this.giveUpWaiting()),
      });
    }, POLL_EVERY_MS);
  }

  private giveUpWaiting(): void {
    this.phase.set('not_yet');
    this.titleService.setTitle(`${TITLES.not_yet} · Booking System Demo`);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** Pay now: back to Stripe's page (the same page while the hold runs). */
  payNow(): void {
    const b = this.booking();
    if (!b || this.busy()) return;
    this.busy.set('pay');
    this.actionError.set(null);
    this.payments.checkout(b.id).subscribe({
      next: (res) => this.redirect.to(res.checkout_url),
      error: (err) => {
        this.busy.set(null);
        this.actionError.set(parseApiErrors(err).general ?? "We couldn't open the payment page. Please try again.");
        this.load(); // the server's answer may mean the state changed (e.g. paid or released)
      },
    });
  }

  cancelBooking(): void {
    const b = this.booking();
    if (!b || this.busy()) return;
    this.dialog
      .open(CancelBookingDialog, { data: b, width: '480px', autoFocus: 'dialog' })
      .afterClosed()
      .subscribe((yes) => {
        if (yes !== true) return;
        this.busy.set('cancel');
        this.actionError.set(null);
        this.bookings.cancel(b.id).subscribe({
          next: (updated) => {
            this.busy.set(null);
            this.show(updated, false);
          },
          error: (err) => {
            this.busy.set(null);
            this.actionError.set(parseApiErrors(err).general ?? "Couldn't cancel the booking. Please try again.");
            this.load();
          },
        });
      });
  }

  /** Book the same stay again (while its dates are still in the future). */
  readonly bookAgain = computed(() => {
    const b = this.booking();
    if (!b) return null;
    const checkIn = parseIsoDate(b.check_in);
    if (checkIn && checkIn >= todayLocal()) {
      return {
        link: ['/booking', b.property.id],
        params: { check_in: b.check_in, check_out: b.check_out, guests: b.guests },
      };
    }
    return { link: ['/listings', b.property.id], params: {} };
  });
}

const TITLES: Partial<Record<ReturnPhase, string>> = {
  confirming: 'Confirming your payment',
  confirmed: 'Booking confirmed',
  processing: 'Payment processing',
  not_yet: 'Waiting for confirmation',
  unpaid: 'Payment not completed',
  released: 'Payment not completed',
  cancelled: 'Booking cancelled',
};

/** Pure: what the page shows for this booking. */
export function phaseFor(b: Booking, returnedAfterPaying: boolean): ReturnPhase {
  const p = b.payment;
  if (b.status === 'cancelled') {
    return p && (p.status === 'expired' || p.status === 'failed') ? 'released' : 'cancelled';
  }
  if (b.status === 'confirmed') return 'confirmed';
  // pending
  switch (p?.status) {
    case 'paid':
    case 'processing':
      return 'processing';
    case 'open':
      if (returnedAfterPaying) return 'confirming';
      return Date.parse(p.expires_at) > Date.now() ? 'unpaid' : 'timed_out';
    case 'expired':
    case 'failed':
      return 'released';
    default:
      return 'cancelled';
  }
}
