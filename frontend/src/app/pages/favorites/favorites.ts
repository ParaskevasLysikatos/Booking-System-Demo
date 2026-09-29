import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';

import { FavoriteService, SavedProperty } from '../../core/favorites/favorite.service';
import { DEFAULT_PAGE_SIZE, Paginated } from '../../core/properties/property.models';
import { PropertyCardComponent } from '../listings/property-card/property-card';
import { providePaginatorI18n } from '../../core/i18n/paginator-i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { translate } from '../../core/i18n/translation.service';

type SavedState =
  | { status: 'loading'; page: number }
  | { status: 'ok'; page: number; data: Paginated<SavedProperty> }
  | { status: 'error'; page: number };

/** How long the "Removed … Undo" snackbar stays. */
export const UNDO_MS = 5000;

/**
 * /favorites - "Saved" (TICKET-033 step 3). The logged-in guest's saved
 * places, most recently saved first, 12 per page (?page= in the URL).
 *
 * - Same cards as the listings (the API returns the same shape). Tapping a
 *   heart here removes the place from the page at once, with an Undo
 *   snackbar; Undo saves it again and it comes back in the same spot.
 * - Places an admin deactivated stay, greyed out as "No longer available"
 *   with a Remove button (no Undo: they can't be saved again).
 * - If every card on a page is removed, the page refills itself from the
 *   server (or steps back a page).
 */
@Component({
  selector: 'app-favorites',
  imports: [MatButtonModule, MatIconModule, MatPaginatorModule, PropertyCardComponent, RouterLink, TranslatePipe],
  templateUrl: './favorites.html',
  providers: [providePaginatorI18n()], // the paginator's texts in the chosen language (TICKET-038)
  styleUrl: './favorites.scss',
})
export class FavoritesPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly favorites = inject(FavoriteService);

  readonly pageSize = DEFAULT_PAGE_SIZE;

  private readonly page$ = this.route.queryParamMap.pipe(
    map((q) => Math.max(1, Number(q.get('page')) || 1)),
  );
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly state = toSignal(
    combineLatest([this.page$, this.refresh$]).pipe(
      switchMap(([page]) =>
        this.favorites.list(page).pipe(
          map((data): SavedState => ({ status: 'ok', page, data })),
          catchError(() => of<SavedState>({ status: 'error', page })),
          startWith<SavedState>({ status: 'loading', page }),
        ),
      ),
    ),
    { initialValue: { status: 'loading', page: 1 } as SavedState },
  );

  private readonly data = computed(() => {
    const s = this.state();
    return s.status === 'ok' ? s.data : null;
  });

  /** This page's cards minus the ones un-hearted here (Undo brings them back). */
  readonly visible = computed(() =>
    (this.data()?.results ?? []).filter((p) => this.favorites.isSaved(p)),
  );

  /** The server's total, minus what was removed on this page since it loaded. */
  readonly total = computed(() => {
    const d = this.data();
    return d ? d.count - (d.results.length - this.visible().length) : 0;
  });

  /** "Removed … Undo" snackbars still on screen - the page waits for them before refilling. */
  private readonly undoOpen = signal(0);

  constructor() {
    // Every card on this page removed, but more saved places exist: refill
    // (once the Undo snackbar is gone, so Undo can still bring the card back).
    effect(() => {
      const s = this.state();
      if (s.status !== 'ok' || s.data.results.length === 0 || this.visible().length > 0) return;
      if (this.undoOpen() > 0) return;
      untracked(() => {
        if (s.page > 1) this.goToPage(s.page - 1);
        else if (this.total() > 0) this.refresh$.next();
      });
    });
  }

  onToggled(property: SavedProperty, saved: boolean): void {
    if (saved) return; // an Undo put it back
    const canUndo = property.is_active;
    const ref = this.snackBar.open(
      translate('saved.removed', { title: property.title }),
      translate(canUndo ? 'saved.undo' : 'common.ok'),
      { duration: UNDO_MS },
    );
    this.undoOpen.update((n) => n + 1);
    ref.afterDismissed().subscribe(() => this.undoOpen.update((n) => n - 1));
    if (canUndo) ref.onAction().subscribe(() => this.favorites.toggle(property));
  }

  onPage(event: PageEvent): void {
    this.goToPage(event.pageIndex + 1);
  }

  retry(): void {
    this.refresh$.next();
  }

  private goToPage(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
    });
  }
}
