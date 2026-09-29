import { Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { formatPrice } from '../../../core/money';
import { MapPin } from '../../../core/properties/property.models';
import { FavoriteButtonComponent } from '../../../shared/favorite-button';
import { formatNumber } from '../../../core/i18n/format';

/**
 * The card that opens when a price tag on the listings map is clicked
 * (TICKET-034): photo, title, rating, location, price per night and - when
 * dates are picked - the stay total, like the listing cards. The whole card
 * links to the property (keeping dates/guests); the heart saves it (guests
 * only, same FavoriteService as the cards, so both always agree).
 */
@Component({
  selector: 'app-map-popup-card',
  imports: [FavoriteButtonComponent, MatIconModule, RouterLink],
  template: `
    <a class="pop" [routerLink]="['/listings', pin().id]" [queryParams]="linkParams()">
      <div class="photo">
        @if (pin().cover_image && !imageFailed()) {
          <img [src]="pin().cover_image" [alt]="pin().title" (error)="imageFailed.set(true)" />
        } @else {
          <div class="no-photo" aria-hidden="true"><mat-icon>image_not_supported</mat-icon></div>
        }
      </div>
      <div class="body">
        <div class="top">
          <span class="title">{{ pin().title }}</span>
          <span class="rating" [attr.aria-label]="pin().rating_avg ? pin().rating_avg + ' out of 5' : 'No reviews yet'">
            @if (pin().rating_avg; as avg) {
              <mat-icon aria-hidden="true">star</mat-icon>{{ formatNumber(avg, 1) }}
              <span class="muted">({{ pin().review_count }})</span>
            } @else {
              <span class="new">New</span>
            }
          </span>
        </div>
        <span class="location">{{ pin().location }}</span>
        <span class="price">
          <strong>{{ nightly() }}</strong><span class="muted">&nbsp;/ night</span>
          @if (stayTotal(); as total) {
            <span class="total">{{ total }} for {{ nights() }} {{ nights() === 1 ? 'night' : 'nights' }}</span>
          }
        </span>
      </div>
    </a>
    <app-favorite-button class="favorite" [property]="pin()" />
  `,
  styles: `
    :host { position: relative; display: block; width: 260px; }
    .pop { display: block; color: inherit; text-decoration: none; }
    .pop:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: -2px; }
    .photo { aspect-ratio: 16 / 10; background: var(--mat-sys-surface-container); }
    .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .no-photo { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--mat-sys-outline); }
    .body { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px 12px; font-size: 13px; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .title { font-weight: 600; font-size: 14px; line-height: 1.3; }
    .rating { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
    .rating mat-icon { font-size: 16px; width: 16px; height: 16px; color: #f5a623; }
    .new { font-size: 12px; color: var(--mat-sys-primary); font-weight: 500; }
    .location, .muted { color: var(--mat-sys-on-surface-variant); }
    .price { margin-top: 4px; }
    .total { display: block; color: var(--mat-sys-on-surface-variant); }
    .favorite { position: absolute; top: 8px; right: 48px; }
  `,
})
export class MapPopupCardComponent {
  /** In the chosen language (TICKET-038). */
  protected readonly formatNumber = formatNumber;
  readonly pin = input.required<MapPin>();
  /** Nights of the searched stay, if dates were picked. */
  readonly nights = input<number | null>(null);
  /** Dates/guests carried to the property page. */
  readonly linkParams = input<Record<string, string | number>>({});

  protected readonly imageFailed = signal(false);
  protected readonly nightly = computed(() => formatPrice(this.pin().price_per_night));
  protected readonly stayTotal = computed(() => {
    const n = this.nights();
    return n ? formatPrice(Number(this.pin().price_per_night) * n) : null;
  });
}
