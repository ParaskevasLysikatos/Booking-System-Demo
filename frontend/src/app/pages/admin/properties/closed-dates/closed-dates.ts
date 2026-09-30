import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCalendarCellClassFunction, MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { parseApiErrors } from '../../../../core/api-errors';
import { ClosedDatesService, ClosedPeriod } from '../../../../core/admin/closed-dates.service';
import { addDays, parseIsoDate, toIsoDate, todayLocal } from '../../../../core/dates';
import { provideLocalizedDatepicker } from '../../../../core/i18n/datepicker-i18n';
import { formatDate } from '../../../../core/i18n/format';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { translate } from '../../../../core/i18n/translation.service';
import { BookedNights } from '../../../../core/properties/availability';
import { BookedRange } from '../../../../core/properties/property.models';
import { asRanges, bookingRanges, closeDateFilter, closeProblem, lastStart } from './closed-dates.rules';

type LoadState = 'loading' | 'ready' | 'error';

/** "10 Oct → 13 Oct 2026" in the chosen language - the end is the day it opens again. */
export function closedRange(block: Pick<ClosedPeriod, 'start' | 'end'>): string {
  const sameYear = block.start.slice(0, 4) === block.end.slice(0, 4);
  return translate('closedDates.range', {
    from: formatDate(block.start, sameYear ? 'dayMonth' : 'medium'),
    to: formatDate(block.end, 'medium'),
  });
}

/**
 * "Closed dates" on the admin property edit page (TICKET-045): the upcoming
 * closed periods with Remove (reopens at once), and Close dates with a
 * date-range picker where booked days are struck through and closed days
 * have their own colour. Saved straight away - not part of the form's Save.
 */
@Component({
  selector: 'app-closed-dates',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  providers: [provideLocalizedDatepicker()], // the picker in the chosen language (TICKET-038)
  templateUrl: './closed-dates.html',
  styleUrl: './closed-dates.scss',
})
export class ClosedDatesComponent implements OnInit {
  private readonly api = inject(ClosedDatesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);

  readonly propertyId = input.required<number>();
  /** The property's `availability.booked_ranges` as loaded by the page (bookings + closed dates). */
  readonly bookedRanges = input<BookedRange[]>([]);

  protected readonly closedRange = closedRange;
  readonly today = todayLocal();
  readonly minDate = this.today;
  /** The end may be the day after the last allowed start. */
  readonly maxDate = addDays(lastStart(this.today), 1);

  readonly state = signal<LoadState>('loading');
  readonly blocks = signal<ClosedPeriod[]>([]);
  /** Booking nights only - worked out once, from the first load (see bookingRanges()). */
  private readonly bookings = signal<BookedRange[]>([]);
  readonly adding = signal(false);
  readonly saving = signal(false);
  readonly removing = signal<number | null>(null);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    dates: this.fb.group({ start: this.fb.control<Date | null>(null), end: this.fb.control<Date | null>(null) }),
    note: this.fb.nonNullable.control('', Validators.maxLength(200)),
  });
  private readonly dates = toSignal(this.form.controls.dates.valueChanges, { initialValue: this.form.controls.dates.value });

  readonly booked = computed(() => new BookedNights(this.bookings()));
  readonly closed = computed(() => new BookedNights(asRanges(this.blocks())));
  /** Days that can't be closed: booked or already closed. */
  readonly taken = computed(() => new BookedNights([...this.bookings(), ...asRanges(this.blocks())]));

  /** Separate signals, so a re-emitted value with the same dates doesn't make a new filter (and re-validate forever). */
  private readonly start = computed(() => this.dates().start ?? null);
  private readonly end = computed(() => this.dates().end ?? null);
  readonly pickerFilter = computed(() => closeDateFilter(this.taken(), this.start(), this.end(), this.today));
  readonly dateClass = computed<MatCalendarCellClassFunction<Date>>(() => {
    const closed = this.closed();
    const booked = this.booked();
    return (d, view) => (view !== 'month' ? '' : closed.isBooked(d) ? 'closed-night' : booked.isBooked(d) ? 'booked-night' : '');
  });

  ngOnInit(): void {
    this.load(true);
  }

  load(first = false): void {
    if (first) this.state.set('loading');
    this.api.list(this.propertyId()).subscribe({
      next: (blocks) => {
        if (first) this.bookings.set(bookingRanges(this.bookedRanges(), blocks));
        this.blocks.set(blocks);
        this.state.set('ready');
      },
      error: () => {
        if (first) this.state.set('error');
        else this.error.set(translate('closedDates.loadFailed'));
      },
    });
  }

  startAdding(): void {
    this.error.set(null);
    this.form.reset({ dates: { start: null, end: null }, note: '' });
    this.adding.set(true);
  }

  cancel(): void {
    this.adding.set(false);
    this.error.set(null);
  }

  isNow(block: ClosedPeriod): boolean {
    const start = parseIsoDate(block.start);
    return !!start && start <= this.today;
  }

  save(): void {
    const { start, end } = this.form.controls.dates.getRawValue();
    const problem = closeProblem(start, end, this.taken(), this.today);
    if (problem || this.form.controls.note.invalid) {
      this.error.set(translate(problem ?? 'closedDates.err.noteTooLong'));
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    const body = { start: toIsoDate(start!), end: toIsoDate(end!), note: this.form.controls.note.value.trim() };
    this.api.close(this.propertyId(), body).subscribe({
      next: (block) => {
        this.saving.set(false);
        this.adding.set(false);
        this.blocks.update((list) => [...list, block].sort((a, b) => a.start.localeCompare(b.start)));
        this.snackBar.open(translate('closedDates.saved', { range: closedRange(block) }), translate('common.ok'), { duration: 4000 });
        this.load(); // anything another admin changed meanwhile
      },
      error: (err) => {
        this.saving.set(false);
        const e = parseApiErrors(err);
        this.error.set(e.general ?? (Object.values(e.fields).flat().join(' ') || translate('closedDates.saveFailed')));
        this.load(); // e.g. someone else just closed or booked these days
      },
    });
  }

  remove(block: ClosedPeriod): void {
    this.error.set(null);
    this.removing.set(block.id);
    this.api.reopen(this.propertyId(), block.id).subscribe({
      next: () => {
        this.removing.set(null);
        this.blocks.update((list) => list.filter((b) => b.id !== block.id));
        this.snackBar.open(translate('closedDates.removed', { range: closedRange(block) }), translate('common.ok'), { duration: 4000 });
      },
      error: (err) => {
        this.removing.set(null);
        if ((err as { status?: number }).status === 404) {
          this.blocks.update((list) => list.filter((b) => b.id !== block.id)); // already gone
          return;
        }
        this.error.set(parseApiErrors(err).general ?? translate('closedDates.removeFailed'));
      },
    });
  }
}
