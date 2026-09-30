import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ClosedPeriod, adminBlocksUrl } from '../../../../core/admin/closed-dates.service';
import { addDays, toIsoDate, todayLocal } from '../../../../core/dates';
import { TranslationService } from '../../../../core/i18n/translation.service';
import { ClosedDatesComponent, closedRange } from './closed-dates';

const iso = (n: number) => toIsoDate(addDays(todayLocal(), n));
const block = (id: number, start: number, end: number, note = ''): ClosedPeriod => ({
  id, property: 5, start: iso(start), end: iso(end), nights: end - start, note,
  created_by: 'admin@demo.com', created_at: '2026-09-30T08:00:00Z',
});
const URL = adminBlocksUrl(5);

describe('ClosedDatesComponent (TICKET-045)', () => {
  let http: HttpTestingController;
  let snack: ReturnType<typeof vi.fn>;

  function create(bookedRanges = [{ check_in: iso(20), check_out: iso(23) }]) {
    TestBed.configureTestingModule({
      imports: [ClosedDatesComponent],
      // No app-level date adapter here: the component brings its own (the page has none).
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    snack = vi.fn();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack as never);
    const fixture = TestBed.createComponent(ClosedDatesComponent);
    fixture.componentRef.setInput('propertyId', 5);
    fixture.componentRef.setInput('bookedRanges', bookedRanges);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = () => el.textContent!.replace(/\s+/g, ' ');
    const render = () => fixture.detectChanges();
    return { cmp: fixture.componentInstance, el, text, render };
  }

  afterEach(() => http.verify());

  it('lists the upcoming closed dates: dates, nights, "closed now", note', () => {
    const { el, text, render } = create([
      { check_in: iso(-1), check_out: iso(2) },
      { check_in: iso(20), check_out: iso(23) },
      { check_in: iso(40), check_out: iso(45) },
    ]);
    expect(el.querySelector('mat-spinner')).not.toBeNull();
    http.expectOne(URL).flush([block(1, -1, 2, 'Maintenance'), block(2, 40, 45)]);
    render();
    const rows = [...el.querySelectorAll('.blocks li')];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain(closedRange(block(1, -1, 2)));
    expect(rows[0].textContent).toContain('3 nights');
    expect(rows[0].textContent).toContain('closed now');
    expect(rows[0].textContent).toContain('Maintenance');
    expect(rows[1].textContent).not.toContain('closed now');
    expect(text()).toContain('Close dates');
  });

  it('nothing coming up / load error with Try again', () => {
    const { text, render, el } = create();
    http.expectOne(URL).flush({ detail: 'x' }, { status: 500, statusText: 'Server Error' });
    render();
    expect(text()).toContain("Couldn't load the closed dates.");
    (el.querySelector('.load-error button') as HTMLButtonElement).click();
    http.expectOne(URL).flush([]);
    render();
    expect(text()).toContain('No closed dates coming up.');
  });

  it('the picker: booked days struck through, closed days in their own colour, both unpickable', () => {
    const { cmp } = create([
      { check_in: iso(10), check_out: iso(12) }, // a booking
      { check_in: iso(20), check_out: iso(23) }, // the block below (booked_ranges has both)
    ]);
    http.expectOne(URL).flush([block(1, 20, 23)]);
    const cls = cmp.dateClass();
    const day = (n: number) => addDays(todayLocal(), n);
    expect(cls(day(10), 'month')).toBe('booked-night');
    expect(cls(day(21), 'month')).toBe('closed-night');
    expect(cls(day(15), 'month')).toBe('');
    expect(cls(day(21), 'year')).toBe('');
    const allowed = cmp.pickerFilter();
    expect(allowed(day(11))).toBe(false);
    expect(allowed(day(22))).toBe(false);
    expect(allowed(day(12))).toBe(true);
  });

  it('Close dates: checks the choice, POSTs it, shows the new period and says so', () => {
    const { cmp, el, text, render } = create();
    http.expectOne(URL).flush([]);
    render();
    (el.querySelector('.add-btn') as HTMLButtonElement).click();
    render();
    expect(el.querySelector('form.add')).not.toBeNull();

    cmp.save(); // nothing picked
    render();
    expect(text()).toContain('Pick the first closed night and the day it opens again.');

    cmp.form.setValue({ dates: { start: addDays(todayLocal(), 21), end: addDays(todayLocal(), 25) }, note: '' });
    cmp.save(); // over the booking
    render();
    expect(text()).toContain('Some of these days are booked or already closed.');

    cmp.form.setValue({ dates: { start: addDays(todayLocal(), 5), end: addDays(todayLocal(), 8) }, note: '  Painting  ' });
    cmp.save();
    const req = http.expectOne({ url: URL, method: 'POST' });
    expect(req.request.body).toEqual({ start: iso(5), end: iso(8), note: 'Painting' });
    req.flush(block(9, 5, 8, 'Painting'), { status: 201, statusText: 'Created' });
    http.expectOne({ url: URL, method: 'GET' }).flush([block(9, 5, 8, 'Painting')]);
    render();
    expect(el.querySelector('form.add')).toBeNull();
    expect(el.querySelectorAll('.blocks li').length).toBe(1);
    expect(text()).toContain('Painting');
    expect(snack.mock.calls[0][0]).toBe(`Dates closed: ${closedRange(block(9, 5, 8))}`);
  });

  it("the server's 409 is shown as it is (e.g. over a pending booking)", () => {
    const { cmp, text, render } = create([]);
    http.expectOne(URL).flush([]);
    cmp.startAdding();
    cmp.form.setValue({ dates: { start: addDays(todayLocal(), 5), end: addDays(todayLocal(), 8) }, note: '' });
    cmp.save();
    http.expectOne({ url: URL, method: 'POST' }).flush(
      { detail: 'These dates overlap booking #45 (…). Cancel or move the booking first.', code: 'booking_overlap' },
      { status: 409, statusText: 'Conflict' },
    );
    http.expectOne({ url: URL, method: 'GET' }).flush([]);
    render();
    expect(text()).toContain('These dates overlap booking #45');
    expect(cmp.adding()).toBe(true); // the choice stays, to fix it
  });

  it('Remove reopens the dates at once', () => {
    const { el, render } = create();
    http.expectOne(URL).flush([block(1, 3, 5), block(2, 30, 31)]);
    render();
    const remove = el.querySelector('.blocks li .remove') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe(`Remove the closed dates ${closedRange(block(1, 3, 5))} and open them again`);
    remove.click();
    http.expectOne({ url: `${URL}1/`, method: 'DELETE' }).flush(null, { status: 204, statusText: 'No Content' });
    render();
    expect(el.querySelectorAll('.blocks li').length).toBe(1);
    expect(snack.mock.calls[0][0]).toContain('Dates open again');
  });

  it('a failed Remove keeps the row and says so; an already removed one just goes', () => {
    const { el, text, render } = create();
    http.expectOne(URL).flush([block(1, 3, 5), block(2, 30, 31)]);
    render();
    (el.querySelector('.blocks li .remove') as HTMLButtonElement).click();
    http.expectOne(`${URL}1/`).flush({}, { status: 500, statusText: 'Server Error' });
    render();
    expect(el.querySelectorAll('.blocks li').length).toBe(2);
    expect(text()).toContain('Server error. Please try again in a moment.');
    (el.querySelectorAll('.blocks li .remove')[1] as HTMLButtonElement).click();
    http.expectOne(`${URL}2/`).flush({ detail: 'Not found.' }, { status: 404, statusText: 'Not Found' });
    render();
    expect(el.querySelectorAll('.blocks li').length).toBe(1);
  });

  it('in Greek', async () => {
    const { text, render, el } = create();
    await TestBed.inject(TranslationService).setLang('el');
    try {
      http.expectOne(URL).flush([block(1, 3, 5, 'Βάψιμο')]);
      render();
      expect(text()).toContain('2 νύχτες');
      expect(text()).toContain('Αφαίρεση');
      expect(text()).toContain('Κλείσιμο ημερομηνιών');
      expect(el.querySelector('.blocks li')!.textContent).toContain('→');
    } finally {
      await TestBed.inject(TranslationService).setLang('en');
    }
  });
});
