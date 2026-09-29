import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { MatPaginatorIntl, MatPaginatorModule } from '@angular/material/paginator';
import { MatStepperIntl } from '@angular/material/stepper';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { LocalizedDateAdapter, provideLocalizedDatepicker } from './datepicker-i18n';
import { providePaginatorI18n } from './paginator-i18n';
import { provideStepperI18n } from './stepper-i18n';
import { TranslationService } from './translation.service';

@Component({
  imports: [MatPaginatorModule],
  template: `<mat-paginator [length]="23" [pageSize]="10" [hidePageSize]="true" />`,
})
class PaginatorHost {}

describe("Material's texts in the chosen language (TICKET-038)", () => {
  let i18n: TranslationService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [...providePaginatorI18n(), ...provideLocalizedDatepicker(), ...provideStepperI18n(), provideNoopAnimations()],
    });
    i18n = TestBed.inject(TranslationService);
  });
  afterEach(() => localStorage.clear());

  it('paginator: labels and the range line, redrawn on a switch', async () => {
    const intl = TestBed.inject(MatPaginatorIntl);
    const changed = vi.fn();
    intl.changes.subscribe(changed);
    expect(intl.nextPageLabel).toBe('Next page');
    expect(intl.getRangeLabel(0, 10, 23)).toBe('1 – 10 of 23');
    expect(intl.getRangeLabel(0, 10, 0)).toBe('0 of 0');

    const fixture = TestBed.createComponent(PaginatorHost);
    await fixture.whenStable();
    const range = () => (fixture.nativeElement as HTMLElement).querySelector('.mat-mdc-paginator-range-label')!.textContent!.trim();
    expect(range()).toBe('1 – 10 of 23');

    i18n.setLang('el');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(intl.nextPageLabel).toBe('Επόμενη σελίδα');
    expect(intl.getRangeLabel(2, 10, 23)).toBe('21 – 23 από 23');
    fixture.detectChanges();
    expect(range()).toBe('1 – 10 από 23');
  });

  it('date picker and stepper labels follow a switch', () => {
    const picker = TestBed.inject(MatDatepickerIntl);
    const stepper = TestBed.inject(MatStepperIntl);
    const pickerChanged = vi.fn();
    const stepperChanged = vi.fn();
    picker.changes.subscribe(pickerChanged);
    stepper.changes.subscribe(stepperChanged);
    expect(picker.openCalendarLabel).toBe('Open calendar');
    expect(stepper.optionalLabel).toBe('Optional');

    i18n.setLang('el');
    expect(picker.openCalendarLabel).toBe('Άνοιγμα ημερολογίου');
    expect(picker.nextMonthLabel).toBe('Επόμενος μήνας');
    expect(picker.formatYearRangeLabel('2024', '2047')).toBe('2024 έως 2047');
    expect(stepper.optionalLabel).toBe('Προαιρετικό');
    expect(pickerChanged).toHaveBeenCalledTimes(1);
    expect(stepperChanged).toHaveBeenCalledTimes(1);
  });

  it('date adapter: the chosen locale, Monday first, re-set on a switch', () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideLocalizedDatepicker()] });
    const adapter = TestBed.inject(DateAdapter) as LocalizedDateAdapter;
    const localeChanged = vi.fn();
    adapter.localeChanges.subscribe(localeChanged);

    const march10 = new Date(2027, 2, 10);
    expect(adapter.getMonthNames('long')[2]).toBe('March');
    expect(adapter.getFirstDayOfWeek()).toBe(1);
    expect(adapter.format(march10, { year: 'numeric', month: 'numeric', day: 'numeric' })).toBe('10/03/2027');

    TestBed.inject(TranslationService).setLang('el');
    expect(localeChanged).toHaveBeenCalledTimes(1);
    expect(adapter.getMonthNames('long')[2]).toBe('Μαρτίου');
    expect(adapter.getDayOfWeekNames('short')[3]).toBe('Τετ');
    expect(adapter.getFirstDayOfWeek()).toBe(1);
    expect(adapter.format(march10, { year: 'numeric', month: 'numeric', day: 'numeric' })).toBe('10/3/2027');
  });
});
