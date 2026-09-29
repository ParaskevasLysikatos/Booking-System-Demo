import { HttpErrorResponse } from '@angular/common/http';

import { amenityLabel } from '../amenities';
import { parseApiErrors } from '../api-errors';
import { Booking } from '../bookings/booking.models';
import { guestRefundText, paymentLabel } from '../payments/payment-labels';
import { BookedNights } from '../properties/availability';
import { stayProblem } from '../properties/stay-rules';
import { clusterTitle } from '../../shared/map/map-markers';
import { setCurrentLang } from './locale';
import { translate } from './translation.service';

/** Texts built outside templates follow the language too (TICKET-038 step 3). */
describe('guest page texts in Greek', () => {
  const d = (day: number) => new Date(2030, 0, day);
  const free = new BookedNights([]);

  beforeEach(() => setCurrentLang('el'));
  afterEach(() => setCurrentLang('en'));

  it('stay rules (property page + booking form)', () => {
    expect(stayProblem(d(10), null, free, d(1))).toBe('Επιλέξτε ημερομηνία αναχώρησης.');
    expect(stayProblem(d(10), d(10), free, d(1))).toBe('Η αναχώρηση πρέπει να είναι μετά την άφιξη.');
    expect(stayProblem(d(10), d(12), free, d(11))).toBe('Η άφιξη δεν μπορεί να είναι στο παρελθόν.');
    expect(stayProblem(new Date(2030, 0, 1), new Date(2030, 1, 15), free, d(1))).toBe('Μια διαμονή μπορεί να είναι έως 30 νύχτες.');
    setCurrentLang('en');
    expect(stayProblem(d(10), null, free, d(1))).toBe('Pick a check-out date.');
  });

  it('amenities: known ones translated, custom ones as typed', () => {
    expect(amenityLabel('sea_view')).toBe('Θέα στη θάλασσα');
    expect(amenityLabel('wifi')).toBe('Wi-Fi');
    expect(amenityLabel('hot_tub')).toBe('Hot tub');
  });

  it('map bubbles and plurals', () => {
    expect(clusterTitle(1)).toBe('1 κατάλυμα εδώ - μεγεθύνετε');
    expect(clusterTitle(3)).toBe('3 καταλύματα εδώ - μεγεθύνετε');
    expect(translate('common.nights', { count: 1 })).toBe('1 νύχτα');
    expect(translate('common.guests', { count: 2 })).toBe('2 επισκέπτες');
  });

  it('payment chips and refund lines (My bookings, return page, admin)', () => {
    const b = (status: Booking['status'], pay: string, refund: unknown = null) =>
      ({ status, payment: { status: pay, amount: '182.00', refund } }) as unknown as Booking;
    expect(paymentLabel(b('pending', 'open'))!.text).toBe('Αναμένεται πληρωμή');
    expect(paymentLabel(b('confirmed', 'cancelled'))!.text).toBe('Χωρίς πληρωμή');
    expect(paymentLabel(b('cancelled', 'paid'))!.text).toBe('Οφειλόμενη επιστροφή');
    expect(guestRefundText({ kind: 'pending', amount: '182 €', refundedOn: null, reason: null })).toBe(
      'Επιστροφή 182 € σε εξέλιξη - στην κάρτα σας μέσα σε 5–10 εργάσιμες ημέρες.',
    );
  });

  it("the app's own error messages", () => {
    expect(parseApiErrors(new HttpErrorResponse({ status: 0 })).general).toBe(
      'Δεν υπάρχει σύνδεση με τον διακομιστή. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.',
    );
    expect(parseApiErrors(new HttpErrorResponse({ status: 503 })).general).toBe('Σφάλμα διακομιστή. Δοκιμάστε ξανά σε λίγο.');
    // A server message is shown as the server wrote it (in Greek too, from step 6).
    expect(parseApiErrors(new HttpErrorResponse({ status: 409, error: { detail: 'Server text.' } })).general).toBe('Server text.');
  });
});
