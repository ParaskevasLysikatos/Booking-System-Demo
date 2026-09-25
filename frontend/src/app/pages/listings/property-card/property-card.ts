import { Component, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { formatPrice } from '../../../core/money';
import { PropertySummary } from '../../../core/properties/property.models';

/** Pretty label for an amenity key: "sea_view" -> "Sea view", "wifi" -> "Wi-Fi". */
export function amenityLabel(key: string): string {
  const special: Record<string, string> = { wifi: 'Wi-Fi', tv: 'TV', air_conditioning: 'Air conditioning' };
  if (special[key]) return special[key];
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
