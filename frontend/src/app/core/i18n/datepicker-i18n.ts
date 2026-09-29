import { Injectable, Provider, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DateAdapter, MAT_DATE_FORMATS, MAT_NATIVE_DATE_FORMATS, NativeDateAdapter } from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';

import { TranslationService } from './translation.service';

/**
 * Date pickers and calendars in the chosen language (TICKET-038): the
 * picker's labels from `mat.datepicker.*` and a date adapter that follows the
 * language, both updated on a switch.
 *
 * Provided per page (component `providers`), not at the root: importing
 * Material's intl classes in app.config would pull ~320 kB of Material code
 * into the initial bundle. The pages that use these components are
 * lazy-loaded and already load that code.
 */
@Injectable()
export class I18nDatepickerIntl extends MatDatepickerIntl {
  private readonly i18n = inject(TranslationService);

  constructor() {
    super();
    this.apply();
    this.i18n.changes.pipe(takeUntilDestroyed()).subscribe(() => {
      this.apply();
      this.changes.next();
    });
  }

  private apply(): void {
    const t = (key: string) => this.i18n.t(`mat.datepicker.${key}`);
    this.calendarLabel = t('calendar');
    this.openCalendarLabel = t('openCalendar');
    this.closeCalendarLabel = t('closeCalendar');
    this.prevMonthLabel = t('prevMonth');
    this.nextMonthLabel = t('nextMonth');
    this.prevYearLabel = t('prevYear');
    this.nextYearLabel = t('nextYear');
    this.prevMultiYearLabel = t('prevMultiYear');
    this.nextMultiYearLabel = t('nextMultiYear');
    this.switchToMonthViewLabel = t('switchToMonthView');
    this.switchToMultiYearViewLabel = t('switchToMultiYearView');
    this.startDateLabel = t('startDate');
    this.endDateLabel = t('endDate');
    this.comparisonDateLabel = t('comparisonDate');
  }

  override formatYearRange(start: string, end: string): string {
    return this.i18n.t('mat.datepicker.yearRange', { start, end });
  }

  override formatYearRangeLabel(start: string, end: string): string {
    return this.i18n.t('mat.datepicker.yearRangeLabel', { start, end });
  }
}

/**
 * The native date adapter, following the chosen language: month and weekday
 * names in the calendar, the typed-date format and the first day of the week
 * (Monday for both en-GB and el-GR). `setLocale` makes open date pickers and
 * inputs re-render on a switch. Replaces the pages' fixed
 * `MAT_DATE_LOCALE: 'en-GB'`.
 */
@Injectable()
export class LocalizedDateAdapter extends NativeDateAdapter {
  constructor() {
    super();
    const i18n = inject(TranslationService);
    this.setLocale(i18n.locale());
    i18n.changes.pipe(takeUntilDestroyed()).subscribe(() => this.setLocale(i18n.locale()));
  }
}

/**
 * For the `providers` of a page with date pickers / calendars: the adapter
 * (dates, month and day names) and the pickers' own labels in the chosen
 * language. Replaces `provideNativeDateAdapter()` + `MAT_DATE_LOCALE: 'en-GB'`.
 */
export function provideLocalizedDatepicker(): Provider[] {
  return [
    { provide: DateAdapter, useClass: LocalizedDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: MAT_NATIVE_DATE_FORMATS },
    { provide: MatDatepickerIntl, useClass: I18nDatepickerIntl },
  ];
}
