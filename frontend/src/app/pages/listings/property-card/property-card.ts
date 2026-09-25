import { Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { amenityLabel } from '../../../core/amenities';
import { formatPrice } from '../../../core/money';
import { PropertySummary } from '../../../core/properties/property.models';

@Component({
  selector: 'app-property-card',
  imports: [MatIconModule, RouterLink],
  templateUrl: './property-card.html',
  styleUrl: './property-card.scss',
})
export class PropertyCardComponent {
  readonly property = input.required<PropertySummary>();
  /** Nights of the searched stay, if dates were picked - shows the stay total. */
  readonly nights = input<number | null>(null);
  /** Carried to the detail page (dates/guests) so it can pre-fill the booking. */
  readonly linkParams = input<Record<string, string | number>>({});

  protected readonly imageFailed = signal(false);
  protected readonly nightly = computed(() => formatPrice(this.property().price_per_night));
  protected readonly stayTotal = computed(() => {
    const n = this.nights();
    return n ? formatPrice(Number(this.property().price_per_night) * n) : null;
  });
  protected readonly amenities = computed(() => this.property().amenities.slice(0, 3).map(amenityLabel));
  protected readonly moreAmenities = computed(() => Math.max(0, this.property().amenities.length - 3));
}
