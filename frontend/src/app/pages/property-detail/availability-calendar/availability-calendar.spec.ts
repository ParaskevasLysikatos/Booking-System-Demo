import { TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';

import { BookedNights } from '../../../core/properties/availability';
import { AvailabilityCalendarComponent, DateSelection } from './availability-calendar';

const d = (day: number, month = 2) => new Date(2027, month - 1, day);

describe('AvailabilityCalendarComponent', () => {
  function create(start: Date | null = null, end: Date | null = null) {
    TestBed.configureTestingModule({ imports: [AvailabilityCalendarComponent], providers: [provideNativeDateAdapter()] });
    const fixture = TestBed.createComponent(AvailabilityCalendarComponent);
    fixture.componentRef.setInput('booked', new BookedNights([{ check_in: '2027-02-04', check_out: '2027-02-16' }]));
    fixture.componentRef.setInput('min', d(1, 1));
    fixture.componentRef.setInput('max', d(1, 12));
    fixture.componentRef.setInput('start', start);
    fixture.componentRef.setInput('end', end);
    fixture.detectChanges();
    const emitted: DateSelection[] = [];
    fixture.componentInstance.selectionChange.subscribe((s) => emitted.push(s));
    return { cmp: fixture.componentInstance, emitted, el: fixture.nativeElement as HTMLElement };
  }

  it('picking a check-in: booked nights are disabled', () => {
    const { cmp } = create();
    const allowed = cmp.dateFilter();
    expect(allowed(d(3))).toBe(true);
    expect(allowed(d(4))).toBe(false);
    expect(allowed(d(16))).toBe(true); // free again
  });

  it('picking a check-out: only ends that keep every night free (incl. someone\'s check-in day)', () => {
    const { cmp } = create(d(1));
    const allowed = cmp.dateFilter();
    expect(allowed(d(4))).toBe(true); // check out as they check in
    expect(allowed(d(5))).toBe(false); // would include the booked night of the 4th
    expect(allowed(d(20))).toBe(false);
  });

  it('click flow: start, then end; clicking before start restarts', () => {
    let { cmp, emitted } = create();
    cmp.pick(d(1));
    expect(emitted.at(-1)).toEqual({ start: d(1), end: null });

    ({ cmp, emitted } = (TestBed.resetTestingModule(), create(d(2))));
    cmp.pick(d(1)); // before the start -> new start
    expect(emitted.at(-1)).toEqual({ start: d(1), end: null });
    cmp.pick(d(3));
    expect(emitted.at(-1)).toEqual({ start: d(2), end: d(3) });
  });

  it('shows two months starting at the chosen check-in and can clear', () => {
    const { cmp, el, emitted } = create(d(2), d(3));
    expect(cmp.months().map((m) => m.getMonth())).toEqual([1, 2]);
    expect(el.textContent).toContain('February 2027');
    expect(el.textContent).toContain('March 2027');
    cmp.clear();
    expect(emitted.at(-1)).toEqual({ start: null, end: null });
  });
});
