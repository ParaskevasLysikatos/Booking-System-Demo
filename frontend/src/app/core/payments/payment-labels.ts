import { Booking } from '../bookings/booking.models';
import { formatPrice } from '../money';
import { formatDate } from '../i18n/format';

export type PaymentTone = 'ok' | 'wait' | 'bad' | 'muted';

/**
 * One short label for a booking's online payment, for chips and cards.
 * `cancelled` means "called off unpaid": the booking was cancelled, or an
 * admin confirmed it by hand (then the payment was waived).
 */
export function paymentLabel(b: Booking): { text: string; tone: PaymentTone } | null {
  const p = b.payment;
  if (!p) return null;
  const refund = refundView(b);
  if (refund) return REFUND_LABEL[refund.kind];
  switch (p.status) {
    case 'paid':
      return { text: 'Paid', tone: 'ok' };
    case 'open':
      return { text: 'Awaiting payment', tone: 'wait' };
    case 'processing':
      return { text: 'Processing', tone: 'wait' };
    case 'expired':
      return { text: 'Expired', tone: 'muted' };
    case 'failed':
      return { text: 'Failed', tone: 'bad' };
    case 'cancelled':
      return b.status === 'confirmed' ? { text: 'Waived', tone: 'muted' } : { text: 'Not paid', tone: 'muted' };
  }
}

const REFUND_LABEL: Record<RefundKind, { text: string; tone: PaymentTone }> = {
  due: { text: 'Refund due', tone: 'bad' },
  pending: { text: 'Refund pending', tone: 'wait' },
  refunded: { text: 'Refunded', tone: 'ok' },
  failed: { text: 'Refund failed', tone: 'bad' },
};

/**
 * Where a booking's refund stands (TICKET-040):
 * - `pending` / `refunded` / `failed` - the server's refund block;
 * - `due` - paid, then cancelled, but no refund was ever started (a booking
 *   cancelled before refunds existed): the host uses "Refund now".
 * null = nothing to refund.
 */
export type RefundKind = 'due' | 'pending' | 'refunded' | 'failed';

export interface RefundView {
  kind: RefundKind;
  amount: string; // formatted, e.g. "€364"
  refundedOn: string | null; // "27 Sep 2026"
  reason: string | null; // admins only
}

export function refundView(b: Booking): RefundView | null {
  const p = b.payment;
  if (!p) return null;
  const r = p.refund;
  if (r) {
    return {
      kind: r.status,
      amount: formatPrice(r.amount ?? p.amount),
      refundedOn: r.refunded_at ? shortDate(r.refunded_at) : null,
      reason: r.failure_reason ?? null,
    };
  }
  if (refundDue(b)) return { kind: 'due', amount: formatPrice(p.amount), refundedOn: null, reason: null };
  return null;
}

/** The guest's one-line refund message (My Bookings, the return page). */
export function guestRefundText(v: RefundView): string {
  switch (v.kind) {
    case 'pending':
      return `Refund of ${v.amount} on its way - back to your card within 5–10 business days.`;
    case 'refunded':
      return v.refundedOn ? `Refunded ${v.amount} on ${v.refundedOn}.` : `Refunded ${v.amount}.`;
    case 'failed':
    case 'due':
      // Never the technical reason - that's for the host to act on.
      return `Full refund of ${v.amount} - the host is arranging your refund.`;
  }
}

/** Paid online, then cancelled, and no refund started yet (see refundView). */
export function refundDue(b: Booking): boolean {
  return b.status === 'cancelled' && b.payment?.status === 'paid' && !b.payment.refund;
}

function shortDate(iso: string): string {
  return formatDate(iso, 'medium');
}
