import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { parseApiErrors } from '../api-errors';
import { AuthService } from '../auth/auth.service';
import { Paginated, PropertySummary } from '../properties/property.models';
import { translate } from '../i18n/translation.service';

export const FAVORITES_URL = `${environment.apiUrl}/favorites/`;

/** Where a logged-out heart tap is parked while the visitor logs in (per tab). */
export const PENDING_FAVORITE_KEY = 'bsd.pendingFavorite';
/** A parked save older than this is dropped instead of completed. */
export const PENDING_FAVORITE_MAX_AGE_MS = 30 * 60 * 1000;

/** The bits of a property the heart needs (a listings card or a detail both fit). */
export interface FavoriteTarget {
  id: number;
  title: string;
  is_favorite?: boolean;
}

export interface FavoriteResponse {
  property: number;
  is_favorite: true;
  saved_at: string;
}

/** A card on the Saved page: the listings card shape + when it was saved (GET /api/favorites/). */
export interface SavedProperty extends PropertySummary {
  saved_at: string;
}

interface PendingFavorite {
  id: number;
  title: string;
  at: number;
}

/**
 * Favorites (TICKET-033) - the one place that knows which places the
 * caller has saved and talks to /api/favorites/.
 *
 * - The server's `is_favorite` on each card/detail is the starting state;
 *   taps made in this session are kept in `overrides`, so every heart for
 *   the same place agrees (card, property page, later the Saved page) even
 *   before the next reload.
 * - Taps are optimistic: the heart changes at once; if the request fails it
 *   switches back and a snackbar says why. A tap while that place's request
 *   is still running is ignored (no out-of-order requests).
 * - Logged out: the tap is parked in sessionStorage and the visitor goes to
 *   /login (and back to this page). As soon as someone logs in, the parked
 *   save is completed. Admin accounts don't get hearts, so for them it's
 *   just dropped.
 */
@Injectable({ providedIn: 'root' })
export class FavoriteService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  private readonly overrides = signal<ReadonlyMap<number, boolean>>(new Map());
  private readonly busy = signal<ReadonlySet<number>>(new Set());
  private lastUserId: number | null | undefined = undefined;

  /** Hearts are for visitors and guests; admins manage listings instead. */
  readonly available = computed(() => !this.auth.isAdmin());

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      untracked(() => this.onUserChange(user?.id ?? null, user?.role === 'admin'));
    });
  }

  // --- state ----------------------------------------------------------------

  isSaved(target: FavoriteTarget): boolean {
    return this.overrides().get(target.id) ?? !!target.is_favorite;
  }

  isBusy(id: number): boolean {
    return this.busy().has(id);
  }

  // --- API ------------------------------------------------------------------

  /** GET - the caller's saved places, most recently saved first, 12 per page (step 3's Saved page). */
  list(page = 1): Observable<Paginated<SavedProperty>> {
    const params = page > 1 ? new HttpParams().set('page', page) : undefined;
    return this.http.get<Paginated<SavedProperty>>(FAVORITES_URL, { params });
  }

  /** PUT - save it (safe to repeat: 201 the first time, 200 after). */
  save(id: number): Observable<FavoriteResponse> {
    return this.http.put<FavoriteResponse>(`${FAVORITES_URL}${id}/`, {});
  }

  /** DELETE - remove it (always 204, even if it wasn't saved). */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${FAVORITES_URL}${id}/`);
  }

  // --- the heart ------------------------------------------------------------

  /**
   * What a heart tap does - see the class comment. Returns the new state
   * (true = saved) if the tap changed it, or null if it was ignored (busy,
   * admin) or sent the visitor to log in.
   */
  toggle(target: FavoriteTarget): boolean | null {
    if (!this.available() || this.isBusy(target.id)) return null;
    if (!this.auth.isLoggedIn()) {
      this.parkAndLogIn(target);
      return null;
    }
    const next = !this.isSaved(target);
    this.setOverride(target.id, next);
    this.send(target, next);
    return next;
  }

  private send(target: FavoriteTarget, saved: boolean, onSaved?: () => void): void {
    this.setBusy(target.id, true);
    const request: Observable<unknown> = saved ? this.save(target.id) : this.remove(target.id);
    request.subscribe({
      next: () => {
        this.setBusy(target.id, false);
        onSaved?.();
      },
      error: (err: unknown) => {
        this.setBusy(target.id, false);
        this.setOverride(target.id, !saved);
        this.snackBar.open(this.failureMessage(err, saved), translate('favorite.ok'), { duration: 6000 });
      },
    });
  }

  private failureMessage(err: unknown, saving: boolean): string {
    if (err instanceof HttpErrorResponse && err.status === 404 && saving) {
      return translate('favorite.gone');
    }
    const failed = translate(saving ? 'favorite.saveFailed' : 'favorite.removeFailed');
    const reason = parseApiErrors(err).general;
    return reason ? `${failed} ${reason}` : failed;
  }

  // --- logged out -> log in -> save ------------------------------------------

  private parkAndLogIn(target: FavoriteTarget): void {
    const pending: PendingFavorite = { id: target.id, title: target.title, at: Date.now() };
    try {
      sessionStorage.setItem(PENDING_FAVORITE_KEY, JSON.stringify(pending));
    } catch {
      // Storage blocked (private mode): the visitor still gets to log in,
      // they'll just have to tap the heart again afterwards.
    }
    void this.router.navigate(['/login'], {
      queryParams: { returnUrl: this.router.url, reason: 'favorite' },
    });
  }

  private takePending(): PendingFavorite | null {
    try {
      const raw = sessionStorage.getItem(PENDING_FAVORITE_KEY);
      sessionStorage.removeItem(PENDING_FAVORITE_KEY);
      if (!raw) return null;
      const pending = JSON.parse(raw) as PendingFavorite;
      const fresh = Date.now() - pending.at <= PENDING_FAVORITE_MAX_AGE_MS;
      return fresh && Number.isInteger(pending.id) ? pending : null;
    } catch {
      return null;
    }
  }

  private onUserChange(userId: number | null, isAdmin: boolean): void {
    if (userId === this.lastUserId) return;
    const first = this.lastUserId === undefined;
    this.lastUserId = userId;
    // Another account (or logged out): the taps we remember were someone else's.
    if (!first) {
      this.overrides.set(new Map());
      this.busy.set(new Set());
    }
    if (userId === null) return;

    const pending = this.takePending();
    if (!pending || isAdmin) return;
    this.setOverride(pending.id, true);
    this.send(pending, true, () =>
      this.snackBar.open(translate('favorite.savedAfterLogin', { title: pending.title }), translate('favorite.ok'), { duration: 4000 }),
    );
  }

  // --- helpers ----------------------------------------------------------------

  private setOverride(id: number, saved: boolean): void {
    this.overrides.update((map) => new Map(map).set(id, saved));
  }

  private setBusy(id: number, busy: boolean): void {
    this.busy.update((set) => {
      const next = new Set(set);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
