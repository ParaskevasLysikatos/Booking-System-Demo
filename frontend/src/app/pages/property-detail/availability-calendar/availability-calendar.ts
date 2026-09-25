import { Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { DateRange, MatCalendarCellClassFunction, MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';

import { nightsBetween } from '../../../core/dates';
import { BookedNights } from '../../../core/properties/availability';
import { MAX_NIGHTS } from '../../../core/properties/property.models';

export interface DateSelection {
  start: Date | null;
  end: Date | null;
}

/** An empty calendar header - this component draws its own month labels/arrows for both months together. */
@Component({ selector: 'app-no-header', template: '' })
export class NoCalendarHeader {}

const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/**
 * Inline two-month availability calendar (one month on phones). Booked
 * nights are struck through and can't be picked. Click a check-in date,
 * then a check-out date; the choice is emitted and mirrored in the
 * booking panel (the parent owns the state).
 */
@Component({
  selector: 'app-availability-calendar',
  imports: [MatButtonModule, MatDatepickerModule, MatIconModule],
  templateUrl: './availability-calendar.html',
  styleUrl: './availability-calendar.scss',
})
export class AvailabilityCalendarComponent {
  readonly booked = input.required<BookedNights>();
  readonly start = input<Date | null>(null);
  readonly end = input<Date | null>(null);
  readonly min = input.required<Date>();
  readonly max = input.required<Date>();
  readonly selectionChange = output<DateSelection>();

  readonly header = NoCalendarHeader;
  /** First of the left-hand month. */
  readonly month = signal<Date | null>(null);
  readonly months = computed(() => {
    const first = this.month() ?? monthStart(this.start() ?? this.min());
    return [first, addMonths(first, 1)];
  });
  readonly canGoBack = computed(() => this.months()[0] > monthStart(this.min()));
  readonly canGoForward = computed(() => this.months()[1] < monthStart(this.max()));

  readonly selected = computed(() => new DateRange<Date>(this.start(), this.end()));

  /** Which dates are clickable depends on whether we're picking check-in or check-out. */
  readonly dateFilter = computed(() => {
    const booked = this.booked();
    const start = this.start();
    const pickingEnd = !!start && !this.end();
    return (d: Date | null): boolean => {
      if (!d) return false;
      if (pickingEnd && start && d > start) {
        // A valid check-out: every night in between is free, within the stay limit.
        // (d itself may be someone else's check-in day - that's allowed.)
        return nightsBetween(start, d) <= MAX_NIGHTS && booked.isFree(start, d);
      }
      return !booked.isBooked(d); // a check-in night must be free
    };
  });

  readonly dateClass = computed<MatCalendarCellClassFunction<Date>>(() => {
    const booked = this.booked();
    return (d) => (booked.isBooked(d) ? 'booked-night' : '');
  });

  shift(delta: number): void {
    this.month.set(addMonths(this.months()[0], delta));
  }

  pick(date: Date | null): void {
    if (!date) return;
    const start = this.start();
    if (!start || this.end() || date <= start) {
      this.selectionChange.emit({ start: date, end: null });
    } else {
      this.selectionChange.emit({ start, end: date });
    }
  }

  clear(): void {
    this.selectionChange.emit({ start: null, end: null });
  }
}
