import { DOCUMENT, Injectable, inject } from '@angular/core';
import type * as Leaflet from 'leaflet';

export type LeafletApi = typeof Leaflet;

/**
 * Leaflet's CSS + the cluster plugin's, built by angular.json as a separate,
 * non-injected bundle ("map-styles") so pages without a map never download it.
 */
export const MAP_STYLESHEET_HREF = 'map-styles.css';

/** Give up waiting for the stylesheet after this long and show the map anyway. */
const STYLESHEET_TIMEOUT_MS = 8000;

/**
 * Loads the map code on first use only (TICKET-034): Leaflet (~40 kB gzipped)
 * and leaflet.markercluster are dynamic imports, so they end up in a lazy
 * chunk and the listings page's first load stays the same size. Loaded once
 * per app; a failed load is forgotten so "Try again" can retry.
 */
@Injectable({ providedIn: 'root' })
export class MapLoader {
  private readonly document = inject(DOCUMENT);
  private loading?: Promise<LeafletApi>;

  load(): Promise<LeafletApi> {
    this.loading ??= this.loadOnce().catch((err) => {
      this.loading = undefined;
      throw err;
    });
    return this.loading;
  }

  protected async loadOnce(): Promise<LeafletApi> {
    const [leafletModule] = await Promise.all([import('leaflet'), this.loadStylesheet()]);
    const L = ((leafletModule as { default?: LeafletApi }).default ?? leafletModule) as LeafletApi;
    // leaflet.markercluster is a classic plugin: it extends the *global* L.
    // Leaflet normally sets window.L itself; make sure before loading it.
    (globalThis as { L?: LeafletApi }).L ??= L;
    await import('leaflet.markercluster');
    return L;
  }

  protected loadStylesheet(): Promise<void> {
    const head = this.document.head;
    if (head.querySelector('link[data-map-styles]')) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const link = this.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAP_STYLESHEET_HREF;
      link.dataset['mapStyles'] = '';
      // Never block the map on the CSS: resolve on load, on error, or after a timeout.
      const done = () => resolve();
      link.addEventListener('load', done, { once: true });
      link.addEventListener('error', done, { once: true });
      setTimeout(done, STYLESHEET_TIMEOUT_MS);
      head.appendChild(link);
    });
  }
}
