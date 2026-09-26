/**
 * Online payment shapes (TICKET-029) - backend payments/serializers.py and
 * payments/views.py. A booking's `payment` is null when it doesn't take
 * online payment (seeded, or booked while payments were off).
 */
export type PaymentStatus = 'open' | 'processing' | 'paid' | 'expired' | 'failed' | 'cancelled';

export interface PaymentSummary {
  status: PaymentStatus;
  amount: string; // "240.15"
  currency: string; // "eur"
  expires_at: string; // end of the date hold (ISO)
  paid_at: string | null;
  /** The *current caller* can pay right now (own booking, pending, hold still running). */
  can_pay: boolean;
}

/** GET /api/payments/config/ - public, no secrets. */
export interface PaymentsConfig {
  enabled: boolean;
  hold_minutes: number;
  currency: string;
}

/** POST /api/bookings/{id}/checkout/ */
export interface CheckoutResponse {
  checkout_url: string;
  expires_at: string;
}

export const PAYMENTS_OFF: PaymentsConfig = { enabled: false, hold_minutes: 30, currency: 'eur' };
