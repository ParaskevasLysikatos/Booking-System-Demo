import { TestBed } from '@angular/core/testing';

import { Booking } from '../core/bookings/booking.models';
import { BookingSummary } from './booking-summary';

const base: Booking = {
  id: 7, property: { id: 5, title: 'Loft', location: 'Chania', price_per_night: '91.00', cover_image: null },
  check_in: '2030-03-10', check_out: '2030-03-12', nights: 2, guests: 1, total_price: '182.00', status: 'confirmed',
  can_cancel: true, cancel_deadline: '2030-03-08T15:00:00+02:00', guest_email: null, created_at: '',
};

function render(b: Booking): string {
  TestBed.resetTestingModule();
  const fixture = TestBed.createComponent(BookingSummary);
  fixture.componentRef.setInput('booking', b);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
}

describe('BookingSummary', () => {
  it('paid: "Paid" row and the full-refund policy', () => {
    const text = render({ ...base, payment: { status: 'paid', amount: '182.00', currency: 'eur', expires_at: '', paid_at: '', can_pay: false } });
    expect(text).toMatch(/Paid\s*€182/);
    expect(text).toContain('Free cancellation until');
    expect(text).toContain('- full refund.');
  });

  it('past the deadline: says it can no longer be cancelled online', () => {
    expect(render({ ...base, can_cancel: false })).toContain("can't be cancelled online");
  });

  it('a cancelled booking shows no cancellation policy at all (found in the E2E run)', () => {
    const text = render({ ...base, status: 'cancelled', can_cancel: false });
    expect(text).not.toContain("can't be cancelled online");
    expect(text).not.toContain('Free cancellation');
    expect(text).toMatch(/Total\s*€182/);
  });
});
