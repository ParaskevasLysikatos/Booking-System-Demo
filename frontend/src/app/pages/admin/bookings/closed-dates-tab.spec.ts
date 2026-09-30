import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';

import { ALL_BLOCKS_URL, ClosedPeriodWithProperty, adminBlocksUrl } from '../../../core/admin/closed-dates.service';
import { addDays, toIsoDate, todayLocal } from '../../../core/dates';
import { TranslationService } from '../../../core/i18n/translation.service';
import { closedRange } from '../properties/closed-dates/closed-dates';
import { ClosedDatesTabComponent } from './closed-dates-tab';

const iso = (n: number) => toIsoDate(addDays(todayLocal(), n));
const block = (id: number, property: number, start: number, end: number, extra: Partial<ClosedPeriodWithProperty> = {}): ClosedPeriodWithProperty => ({
  id, property, start: iso(start), end: iso(end), nights: end - start, note: '', created_by: 'admin@demo.com',
  created_at: '', property_title: `Place ${property}`, property_is_active: true, ...extra,
});

describe('ClosedDatesTabComponent (TICKET-045)', () => {
  let http: HttpTestingController;
  let snack: ReturnType<typeof vi.fn>;

  function create(property: number | null = null) {
    TestBed.configureTestingModule({
      imports: [ClosedDatesTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    snack = vi.fn();
    vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockImplementation(snack as never);
    const fixture = TestBed.createComponent(ClosedDatesTabComponent);
    fixture.componentRef.setInput('property', property);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, render: () => fixture.detectChanges(), text: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  afterEach(() => http.verify());

  it("lists every property's closed dates: property (linked), dates, nights, note, who, retired", () => {
    const { el, render, text } = create();
    expect(el.querySelector('.skeleton')).not.toBeNull();
    http.expectOne(ALL_BLOCKS_URL).flush([
      block(1, 5, -1, 2, { note: 'Maintenance' }),
      block(2, 7, 10, 12, { property_is_active: false }),
    ]);
    render();
    expect(text()).toContain('2 closed periods coming up');
    const rows = [...el.querySelectorAll('.blocks li')];
    expect(rows[0].querySelector('a.prop')!.getAttribute('href')).toBe('/admin/properties/5/edit');
    expect(rows[0].textContent).toContain(closedRange(block(1, 5, -1, 2)));
    expect(rows[0].textContent).toContain('3 nights');
    expect(rows[0].textContent).toContain('closed now');
    expect(rows[0].textContent).toContain('Maintenance');
    expect(rows[0].textContent).toContain('by admin@demo.com');
    expect(rows[1].textContent).toContain('Retired');
    expect(rows[1].textContent).not.toContain('closed now');
  });

  it('follows the Property filter', () => {
    const { fixture } = create(7);
    http.expectOne((r) => r.url === ALL_BLOCKS_URL && r.params.get('property') === '7').flush([]);
    fixture.componentRef.setInput('property', null);
    fixture.detectChanges();
    http.expectOne((r) => r.url === ALL_BLOCKS_URL && !r.params.has('property')).flush([]);
  });

  it('empty: says where dates are closed; error: Try again', () => {
    const { el, render, text } = create();
    http.expectOne(ALL_BLOCKS_URL).flush({}, { status: 500, statusText: 'Server Error' });
    render();
    expect(text()).toContain("Couldn't load the closed dates.");
    (el.querySelector('.message button') as HTMLButtonElement).click();
    http.expectOne(ALL_BLOCKS_URL).flush([]);
    render();
    expect(text()).toContain('No closed dates coming up.');
    expect(el.querySelector('.how a')!.getAttribute('href')).toBe('/admin/properties');
  });

  it('Remove reopens at once (DELETE on that property), a failure says why', () => {
    const { el, render } = create();
    http.expectOne(ALL_BLOCKS_URL).flush([block(1, 5, 3, 5), block(2, 7, 8, 9)]);
    render();
    const buttons = () => [...el.querySelectorAll('.blocks li .remove')] as HTMLButtonElement[];
    expect(buttons()[0].getAttribute('aria-label')).toContain('of Place 5');
    buttons()[1].click();
    http.expectOne({ url: `${adminBlocksUrl(7)}2/`, method: 'DELETE' }).flush(null, { status: 204, statusText: 'No Content' });
    render();
    expect(el.querySelectorAll('.blocks li').length).toBe(1);
    expect(snack.mock.calls[0][0]).toBe(`Dates open again: Place 7, ${closedRange(block(2, 7, 8, 9))}`);
    buttons()[0].click();
    http.expectOne(`${adminBlocksUrl(5)}1/`).flush({ detail: 'Nope.' }, { status: 403, statusText: 'Forbidden' });
    render();
    expect(el.querySelectorAll('.blocks li').length).toBe(1);
    expect(snack.mock.calls[1][0]).toBe('Nope.');
  });

  it('in Greek', async () => {
    const { render, text } = create();
    await TestBed.inject(TranslationService).setLang('el');
    try {
      http.expectOne(ALL_BLOCKS_URL).flush([block(1, 5, 3, 5)]);
      render();
      expect(text()).toContain('1 επερχόμενη κλειστή περίοδος');
      expect(text()).toContain('από admin@demo.com');
    } finally {
      await TestBed.inject(TranslationService).setLang('en');
    }
  });
});
