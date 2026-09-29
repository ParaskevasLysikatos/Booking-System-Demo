import { Booking } from '../bookings/booking.models';
import { formatPrice } from '../money';
import { formatDate } from '../i18n/format';
import { translate } from '../i18n/translation.service';

export type PaymentTone = 'ok' | 'wait' | 'bad' | 'muted';

/**
 * One short label for a booking's online payment, for chips and cards.
 * `cancelled` means "called off unpaid": the booking was cancelled, or an
 * admin confirmed it by hand (then the payment was waived). In the chosen
 * language (TICKET-038) - call it from a template or `computed()`.
 */
export function paymentLabel(b: Booking): { text: string; tone: PaymentTone } | null {
  const p = b.payment;
  if (!p) return null;
  const refund = refundView(b);
  const label = (key: string, tone: PaymentTone) => ({ text: translate(`payment.label.${key}`), tone });
  if (refund) return label(REFUND_LABEL[refund.kind].key, REFUND_LABEL[refund.kind].tone);
  switch (p.status) {
    case 'paid':
      return label('paid', 'ok');
    case 'open':
      return label('open', 'wait');
    case 'processing':
      return label('processing', 'wait');
    case 'expired':
      return label('expired', 'muted');
    case 'failed':
      return label('failed', 'bad');
    case 'cancelled':
      return b.status === 'confirmed' ? label('waived', 'muted') : label('notPaid', 'muted');
  }
}

const REFUND_LABEL: Record<RefundKind, { key: string; tone: PaymentTone }> = {
  due: { key: 'refundDue', tone: 'bad' },
  pending: { key: 'refundPending', tone: 'wait' },
  refunded: { key: 'refunded', tone: 'ok' },
  failed: { key: 'refundFailed', tone: 'bad' },
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
      return translate('payment.refund.pending', { amount: v.amount });
    case 'refunded':
      return v.refundedOn
        ? translate('payment.refund.refundedOn', { amount: v.amount, date: v.refundedOn })
        : translate('payment.refund.refunded', { amount: v.amount });
    case 'failed':
    case 'due':
      // Never the technical reason - that's for the host to act on.
      return translate('payment.refund.arranging', { amount: v.amount });
  }
}

/** Paid online, then cancelled, and no refund started yet (see refundView). */
export function refundDue(b: Booking): boolean {
  return b.status === 'cancelled' && b.payment?.status === 'paid' && !b.payment.refund;
}

function shortDate(iso: string): string {
  return formatDate(iso, 'medium');
}
