import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { amenityLabel } from '../../../core/amenities';
import { FavoriteService } from '../../../core/favorites/favorite.service';
import { formatPrice } from '../../../core/money';
import { PropertySummary } from '../../../core/properties/property.models';
import { FavoriteButtonComponent } from '../../../shared/favorite-button';

@Component({
  selector: 'app-property-card',
  imports: [FavoriteButtonComponent, MatButtonModule, MatIconModule, NgTemplateOutlet, RouterLink],
  templateUrl: './property-card.html',
  styleUrl: './property-card.scss',
})
export class PropertyCardComponent {
  readonly property = input.required<PropertySummary>();
  /** Nights of the searched stay, if dates were picked - shows the stay total. */
  readonly nights = input<number | null>(null);
  /** Carried to the detail page (dates/guests) so it can pre-fill the booking. */
  readonly linkParams = input<Record<string, string | number>>({});

  /** A tap on the heart (or Remove) changed the saved state - true = saved (TICKET-033). */
  readonly favoriteToggled = output<boolean>();

  private readonly favorites = inject(FavoriteService);

  /**
   * Deactivated by an admin. Only the Saved page ever gets these (the
   * listings only return active places): greyed out, not a link, with
   * Remove instead of the heart (TICKET-033).
   */
  protected readonly unavailable = computed(() => this.property().is_active === false);

  protected readonly imageFailed = signal(false);
  protected readonly nightly = computed(() => formatPrice(this.property().price_per_night));
  protected readonly stayTotal = computed(() => {
    const n = this.nights();
    return n ? formatPrice(Number(this.property().price_per_night) * n) : null;
  });
  protected readonly amenities = computed(() => this.property().amenities.slice(0, 3).map(amenityLabel));
  protected readonly moreAmenities = computed(() => Math.max(0, this.property().amenities.length - 3));

  protected remove(): void {
    const saved = this.favorites.toggle(this.property());
    if (saved !== null) this.favoriteToggled.emit(saved);
  }
}
