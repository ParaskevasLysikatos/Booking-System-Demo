import { Component, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';

import { parseApiErrors } from '../../../core/api-errors';
import { ClosedDatesService, ClosedPeriodWithProperty } from '../../../core/admin/closed-dates.service';
import { parseIsoDate, todayLocal } from '../../../core/dates';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { translate } from '../../../core/i18n/translation.service';
import { closedRange } from '../properties/closed-dates/closed-dates';

type TabState = { status: 'loading' } | { status: 'ok'; blocks: ClosedPeriodWithProperty[] } | { status: 'error' };

/**
 * The "Closed dates" tab of /admin/bookings (TICKET-045): every property's
 * upcoming closed dates in one place, with Remove. Closing new dates is done
 * on the property's edit page (the picker needs that property's calendar),
 * so each row links there.
 */
@Component({
  selector: 'app-closed-dates-tab',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
  template: `
    @switch (state().status) {
      @case ('loading') {
        <div class="skeleton" aria-busy="true">@for (i of [1, 2, 3]; track i) { <div class="row"></div> }</div>
      }
      @case ('error') {
        <div class="message" role="alert">
          <mat-icon>cloud_off</mat-icon>
          <p>{{ 'closedDates.loadFailed' | t }}</p>
          <button mat-stroked-button type="button" (click)="reload()">{{ 'common.tryAgain' | t }}</button>
        </div>
      }
      @case ('ok') {
        @let blocks = list();
        @if (!blocks.length) {
          <div class="message">
            <mat-icon>event_available</mat-icon>
            <p>{{ 'closedDates.empty' | t }}</p>
            <p class="how">{{ 'closedDates.howTo' | t }} <a routerLink="/admin/properties">{{ 'admin.nav.properties' | t }}</a></p>
          </div>
        } @else {
          <p class="count">{{ 'closedDates.count' | t: { count: blocks.length } }}</p>
          <ul class="blocks">
            @for (b of blocks; track b.id) {
              <li>
                <mat-icon class="lead" aria-hidden="true">event_busy</mat-icon>
                <div class="what">
                  <a class="prop" [routerLink]="['/admin/properties', b.property, 'edit']">{{ b.property_title }}</a>
                  @if (!b.property_is_active) { <span class="retired">{{ 'adminProps.retired' | t }}</span> }
                  <span class="range">{{ closedRange(b) }}</span>
                  <span class="meta">
                    {{ 'common.nights' | t: { count: b.nights } }}
                    @if (isNow(b)) { · <span class="now">{{ 'closedDates.inProgress' | t }}</span> }
                    @if (b.note) { · <span class="note">{{ b.note }}</span> }
                    @if (b.created_by) { · {{ 'closedDates.by' | t: { who: b.created_by } }} }
                  </span>
                </div>
                <button mat-button type="button" class="remove" [disabled]="removing() === b.id"
                        [attr.aria-label]="'closedDates.removeLabelFor' | t: { range: closedRange(b), title: b.property_title }"
                        (click)="remove(b)">
                  @if (removing() === b.id) { <mat-spinner diameter="18" /> } @else { <mat-icon>lock_open</mat-icon> }
                  {{ 'closedDates.remove' | t }}
                </button>
              </li>
            }
          </ul>
        }
      }
    }
  `,
  styles: `
    .count { margin: 0 0 8px; color: var(--mat-sys-on-surface-variant); font-size: 14px; }
    .blocks { list-style: none; margin: 0; padding: 0 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 16px; }
    .blocks li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .blocks li:last-child { border-bottom: 0; }
    .lead { color: var(--mat-sys-tertiary); flex: none; }
    .what { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .prop { font-weight: 500; color: inherit; overflow-wrap: anywhere; }
    .retired { align-self: flex-start; margin-top: 2px; padding: 0 8px; border-radius: 999px; font-size: 12px;
      background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
    .range { margin-top: 2px; }
    .meta { font-size: 13px; color: var(--mat-sys-on-surface-variant); overflow-wrap: anywhere; }
    .now { color: var(--mat-sys-tertiary); font-weight: 500; }
    .remove { flex: none; }
    .remove mat-spinner { display: inline-block; margin-right: 6px; }
    .skeleton .row { height: 64px; margin-bottom: 8px; border-radius: 8px; background: var(--mat-sys-surface-container-high); }
    .message { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; color: var(--mat-sys-on-surface-variant); text-align: center; }
    .message mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .message p { margin: 0; }
    @media (max-width: 600px) {
      .blocks li { flex-wrap: wrap; row-gap: 4px; }
      .what { flex-basis: calc(100% - 36px); }
      .remove { margin-left: 28px; }
    }
  `,
})
export class ClosedDatesTabComponent {
  private readonly api = inject(ClosedDatesService);
  private readonly snackBar = inject(MatSnackBar);

  /** From the page's Property filter (null = all properties). */
  readonly property = input<number | null>(null);

  protected readonly closedRange = closedRange;
  readonly removing = signal<number | null>(null);
  /** Rows removed since the last load - hidden at once, without waiting for a reload. */
  private readonly gone = signal<ReadonlySet<number>>(new Set());
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly state = toSignal(
    combineLatest([toObservable(this.property), this.refresh$]).pipe(
      switchMap(([property]) =>
        this.api.listAll(property).pipe(
          map((blocks): TabState => ({ status: 'ok', blocks })),
          catchError(() => of<TabState>({ status: 'error' })),
          startWith<TabState>({ status: 'loading' }),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as TabState },
  );

  list(): ClosedPeriodWithProperty[] {
    const s = this.state();
    const gone = this.gone();
    return s.status === 'ok' ? s.blocks.filter((b) => !gone.has(b.id)) : [];
  }

  reload(): void {
    this.gone.set(new Set());
    this.refresh$.next();
  }

  isNow(b: ClosedPeriodWithProperty): boolean {
    const start = parseIsoDate(b.start);
    return !!start && start <= todayLocal();
  }

  remove(b: ClosedPeriodWithProperty): void {
    this.removing.set(b.id);
    this.api.reopen(b.property, b.id).subscribe({
      next: () => {
        this.removing.set(null);
        this.gone.update((s) => new Set([...s, b.id]));
        this.snackBar.open(translate('closedDates.removedFor', { range: closedRange(b), title: b.property_title }), translate('common.ok'), {
          duration: 4000,
        });
      },
      error: (err) => {
        this.removing.set(null);
        if ((err as { status?: number }).status === 404) {
          this.gone.update((s) => new Set([...s, b.id]));
          return;
        }
        this.snackBar.open(parseApiErrors(err).general ?? translate('closedDates.removeFailed'), translate('common.ok'), { duration: 7000 });
      },
    });
  }
}
