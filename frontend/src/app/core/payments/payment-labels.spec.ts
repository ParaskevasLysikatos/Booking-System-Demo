import { Booking } from '../bookings/booking.models';
import { PaymentStatus } from './payment.models';
import { paymentLabel, refundDue } from './payment-labels';

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

  it('paid then cancelled = refund due (full refund policy)', () => {
    expect(refundDue(b('cancelled', 'paid'))).toBe(true);
    expect(paymentLabel(b('cancelled', 'paid'))).toEqual({ text: 'Refund due', tone: 'bad' });
    expect(refundDue(b('confirmed', 'paid'))).toBe(false);
    expect(refundDue(b('cancelled', 'expired'))).toBe(false);
  });
});
