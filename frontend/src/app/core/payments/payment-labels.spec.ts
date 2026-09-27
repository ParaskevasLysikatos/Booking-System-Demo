import { Booking } from '../bookings/booking.models';
import { PaymentStatus, RefundSummary } from './payment.models';
import { guestRefundText, paymentLabel, refundDue, refundView } from './payment-labels';

const b = (status: Booking['status'], payment: PaymentStatus | null): Booking => ({
  id: 1, property: { id: 5, title: 'Loft', location: 'Chania', price_per_night: '80.00', cover_image: null },
  check_in: '2030-01-10', check_out: '2030-01-12', nights: 2, guests: 1, total_price: '160.00', status,
  can_cancel: true, cancel_deadline: '', guest_email: null, created_at: '',
  payment: payment && { status: payment, amount: '160.00', currency: 'eur', expires_at: '', paid_at: null, can_pay: false },
});

describe('payment labels', () => {
  it('maps every payment state to one label', () => {
    expect(paymentLabel(b('pending', null))).toBeNull();
    expect(paymentLabel(b('confirmed', 'paid'))).toEqual({ text: 'Paid', tone: 'ok' });
    expect(paymentLabel(b('pending', 'open'))).toEqual({ text: 'Awaiting payment', tone: 'wait' });
    expect(paymentLabel(b('pending', 'processing'))).toEqual({ text: 'Processing', tone: 'wait' });
    expect(paymentLabel(b('cancelled', 'expired'))).toEqual({ text: 'Expired', tone: 'muted' });
    expect(paymentLabel(b('cancelled', 'failed'))).toEqual({ text: 'Failed', tone: 'bad' });
    expect(paymentLabel(b('confirmed', 'cancelled'))).toEqual({ text: 'Waived', tone: 'muted' });
    expect(paymentLabel(b('cancelled', 'cancelled'))).toEqual({ text: 'Not paid', tone: 'muted' });
  });

  it('paid then cancelled with no refund started = refund due (bookings cancelled before TICKET-040)', () => {
    expect(refundDue(b('cancelled', 'paid'))).toBe(true);
    expect(paymentLabel(b('cancelled', 'paid'))).toEqual({ text: 'Refund due', tone: 'bad' });
    expect(refundDue(b('confirmed', 'paid'))).toBe(false);
    expect(refundDue(b('cancelled', 'expired'))).toBe(false);
  });

  // --- TICKET-040 ---------------------------------------------------------

  const withRefund = (status: Booking['status'], refund: Partial<RefundSummary> & Pick<RefundSummary, 'status'>): Booking => {
    const x = b(status, 'paid');
    x.payment!.refund = { amount: '160.00', requested_at: '2030-01-01T10:00:00Z', refunded_at: null, ...refund };
    return x;
  };

  it('refund chips: pending / refunded / failed (and never "Refund due" once a refund exists)', () => {
    expect(paymentLabel(withRefund('cancelled', { status: 'pending' }))).toEqual({ text: 'Refund pending', tone: 'wait' });
    expect(paymentLabel(withRefund('cancelled', { status: 'refunded' }))).toEqual({ text: 'Refunded', tone: 'ok' });
    expect(paymentLabel(withRefund('cancelled', { status: 'failed' }))).toEqual({ text: 'Refund failed', tone: 'bad' });
    expect(refundDue(withRefund('cancelled', { status: 'failed' }))).toBe(false);
    // refunded by hand in the Stripe Dashboard while still confirmed
    expect(paymentLabel(withRefund('confirmed', { status: 'refunded' }))).toEqual({ text: 'Refunded', tone: 'ok' });
  });

  it('refundView: amount, refund date, admin-only reason', () => {
    expect(refundView(b('confirmed', 'paid'))).toBeNull();
    expect(refundView(b('cancelled', 'paid'))).toEqual({ kind: 'due', amount: '€160', refundedOn: null, reason: null });
    expect(refundView(withRefund('cancelled', { status: 'refunded', refunded_at: '2026-09-27T10:00:00Z' })))
      .toEqual({ kind: 'refunded', amount: '€160', refundedOn: expect.stringMatching(/^27 Sept? 2026$/), reason: null });
    expect(refundView(withRefund('cancelled', { status: 'failed', failure_reason: "Couldn't reach Stripe." }))!.reason)
      .toBe("Couldn't reach Stripe.");
  });

  it('guest wording never shows the technical reason', () => {
    const text = (r: Partial<RefundSummary> & Pick<RefundSummary, 'status'>) => guestRefundText(refundView(withRefund('cancelled', r))!);
    expect(text({ status: 'pending' })).toBe('Refund of €160 on its way - back to your card within 5–10 business days.');
    expect(text({ status: 'refunded', refunded_at: '2026-09-27T10:00:00Z' })).toMatch(/^Refunded €160 on 27 Sept? 2026\.$/);
    expect(text({ status: 'failed', failure_reason: 'secret' })).toBe('Full refund of €160 - the host is arranging your refund.');
    expect(guestRefundText(refundView(b('cancelled', 'paid'))!)).toBe('Full refund of €160 - the host is arranging your refund.');
  });
});
