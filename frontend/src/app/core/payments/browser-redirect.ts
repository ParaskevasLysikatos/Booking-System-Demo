import { Injectable } from '@angular/core';

/**
 * Leaves the app for another site (Stripe's payment page). Its own tiny
 * service so tests can replace it instead of actually navigating away.
 */
@Injectable({ providedIn: 'root' })
export class BrowserRedirect {
  to(url: string): void {
    window.location.assign(url);
  }
}
