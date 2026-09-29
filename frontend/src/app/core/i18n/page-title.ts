import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { TParams, TranslationService } from './translation.service';

/**
 * The browser tab title in the chosen language (TICKET-038):
 * "<page> · Booking System Demo".
 *
 * - Routes give a dictionary key as their `title` (`title: 'titles.login'`).
 * - Pages whose title depends on data (a property's name, a booking number)
 *   call `set(() => ...)` / `setKey(...)` instead; their routes have no
 *   static `title`, so the router leaves the page's own title alone.
 * Either way the title is rebuilt on a language switch.
 */
@Injectable({ providedIn: 'root' })
export class PageTitle extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(TranslationService);
  private page: (() => string) | null = null;
  /** Whether `page` came from a route's `title` (vs a page's own `set`). */
  private fromRoute = false;

  constructor() {
    super();
    this.i18n.changes.subscribe(() => this.apply());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    if (routeTitle === undefined) {
      // The page sets its own title. It may already have (pages are created
      // before the router calls this), so only drop a *route* title - the
      // previous page's - so a switch doesn't bring it back.
      if (this.fromRoute) this.page = null;
      return;
    }
    this.page = () => (this.i18n.has(routeTitle) ? this.i18n.t(routeTitle) : routeTitle);
    this.fromRoute = true;
    this.apply();
  }

  /** The page part of the title, as a function so it can be rebuilt in the new language. */
  set(page: () => string): void {
    this.page = page;
    this.fromRoute = false;
    this.apply();
  }

  /** Shortcut for `set(() => t(key, params))`. */
  setKey(key: string, params?: TParams): void {
    this.set(() => this.i18n.t(key, params));
  }

  private apply(): void {
    if (!this.page) return; // nothing of ours to (re)build
    this.title.setTitle(`${this.page()} · ${this.i18n.t('app.name')}`);
  }
}
