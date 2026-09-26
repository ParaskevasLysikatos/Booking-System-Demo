import { Booking } from '../bookings/booking.models';
import { formatPrice } from '../money';

export type PaymentTone = 'ok' | 'wait' | 'bad' | 'muted';

/**
 * One short label for a booking's online payment, for chips and cards.
 * `cancelled` means "called off unpaid": the booking was cancelled, or an
 * admin confirmed it by hand (then the payment was waived).
 */
export function paymentLabel(b: Booking): { text: string; tone: PaymentTone } | null {
  const p = b.payment;
  if (!p) return null;
  if (refundDue(b)) return { text: 'Refund due', tone: 'bad' };
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

/**
 * Paid online, then cancelled: the guest is owed a full refund (policy:
 * free cancellation until 48h before check-in). Until TICKET-040 automates
 * it, the host refunds from the Stripe dashboard.
 */
export function refundDue(b: Booking): boolean {
  return b.status === 'cancelled' && b.payment?.status === 'paid';
}

export function paidAmount(b: Booking): string {
  return formatPrice(b.payment?.amount ?? b.total_price);
}
