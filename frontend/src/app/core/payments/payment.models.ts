/**
 * Online payment shapes (TICKET-029) - backend payments/serializers.py and
 * payments/views.py. A booking's `payment` is null when it doesn't take
 * online payment (seeded, or booked while payments were off).
 */
export type PaymentStatus = 'open' | 'processing' | 'paid' | 'expired' | 'failed' | 'cancelled';

/** TICKET-040: a refund tracked beside a paid payment (null = none). */
export type RefundStatus = 'pending' | 'refunded' | 'failed';

export interface RefundSummary {
  status: RefundStatus;
  amount: string | null; // always the full amount
  requested_at: string | null;
  refunded_at: string | null;
  /** Admins only (absent for guests): why the last attempt failed. */
  failure_reason?: string | null;
}

export interface PaymentSummary {
  status: PaymentStatus;
  amount: string; // "240.15"
  currency: string; // "eur"
  expires_at: string; // end of the date hold (ISO)
  paid_at: string | null;
  /** The *current caller* can pay right now (own booking, pending, hold still running). */
  can_pay: boolean;
  /** TICKET-040 (optional so older responses still type-check). */
  refund?: RefundSummary | null;
  /** Admins only: "Refund now" is offered (cancelled + paid; refund never started, failed or never sent). */
  can_refund?: boolean;
}

/** GET /api/payments/config/ - public, no secrets. */
export interface PaymentsConfig {
  enabled: boolean;
  test_mode: boolean;
  hold_minutes: number;
  currency: string;
}

/** POST /api/bookings/{id}/checkout/ */
export interface CheckoutResponse {
  checkout_url: string;
  expires_at: string;
}

export const PAYMENTS_OFF: PaymentsConfig = { enabled: false, test_mode: false, hold_minutes: 30, currency: 'eur' };
