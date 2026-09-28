import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { PropertyDetail } from '../../../core/properties/property.models';
import { MapComponent } from '../../../shared/map/map';
import { MapMarker } from '../../../shared/map/map-markers';

/** Zoom Google Maps opens at: about the size of the 500 m area. */
const GOOGLE_MAPS_ZOOM = 15;

/** Google Maps URLs (https://developers.google.com/maps/documentation/urls/get-started). */
export function googleMapsAreaUrl(lat: number, lng: number): string {
  // map_action=map: the area, with no pin - a pin would look exact.
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lng}&zoom=${GOOGLE_MAPS_ZOOM}`;
}

export function googleMapsPinUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function googleMapsSearchUrl(text: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}

/**
 * "Where you'll be" on the property page (TICKET-034 step 6).
 *
 * - Guests / logged out: a shaded ~500 m circle around the approximate
 *   point the API sends - the real place is inside it, never at its centre
 *   (backend listings/geo.py) - plus "Open in Google Maps" showing that area.
 * - Admins: the exact point as a pin, and Google Maps with a pin.
 * - No position yet: the location text and a Google Maps search for it.
 *
 * A compact map: no scroll-wheel zoom, so scrolling the page never gets
 * stuck in it (the +/- buttons, pinch and double-click still zoom).
 */
@Component({
  selector: 'app-property-location',
  imports: [MapComponent, MatIconModule],
  template: `
    @if (marker(); as m) {
      <app-map
        class="map"
        [markers]="[m]"
        [cluster]="false"
        [scrollWheelZoom]="false"
        [ariaLabel]="mapLabel()"
      />
    }
    <p class="where"><mat-icon aria-hidden="true">place</mat-icon>{{ property().location }}</p>
    @if (approximate()) {
      <p class="note">Shown within about {{ radiusText() }} to protect the host's privacy.</p>
    } @else if (marker()) {
      <p class="note">Exact location - only admins see this. Guests see a {{ radiusText() }} area.</p>
    }
    <a class="gmaps" [href]="googleMapsUrl()" target="_blank" rel="noopener noreferrer">
      <mat-icon aria-hidden="true">open_in_new</mat-icon>Open in Google Maps
      <span class="sr-only">(opens in a new tab)</span>
    </a>
  `,
  styles: `
    :host { display: block; }
    .map { height: 320px; margin-bottom: 12px; }
    .where { display: flex; align-items: center; gap: 4px; margin: 0; font-weight: 500; }
    .where mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--mat-sys-on-surface-variant); }
    .note { margin: 4px 0 0; font-size: 14px; color: var(--mat-sys-on-surface-variant); }
    .gmaps {
      display: inline-flex; align-items: center; gap: 4px; margin-top: 8px;
      color: var(--mat-sys-primary); font-weight: 500; text-decoration: none;
    }
    .gmaps:hover { text-decoration: underline; }
    .gmaps mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `,
})
export class PropertyLocationComponent {
  readonly property = input.required<PropertyDetail>();

  private readonly point = computed(() => {
    const { latitude, longitude } = this.property();
    return typeof latitude === 'number' && typeof longitude === 'number' ? { lat: latitude, lng: longitude } : null;
  });

  /** Guests' view: the API marks the point as approximate (admins get the exact one). */
  protected readonly approximate = computed(() => !!this.point() && this.property().location_is_approximate !== false);
  private readonly radius = computed(() => this.property().location_radius_m ?? 500);
  protected readonly radiusText = computed(() => `${this.radius()} m`);

  protected readonly marker = computed<MapMarker | null>(() => {
    const at = this.point();
    if (!at) return null;
    const { id, title } = this.property();
    return this.approximate()
      ? { id, ...at, title: `Approximate area of ${title}`, areaRadiusM: this.radius() }
      : { id, ...at, title: `Exact location of ${title}` };
  });

  protected readonly mapLabel = computed(() =>
    this.approximate()
      ? `Map: the area around ${this.property().title}`
      : `Map: exact location of ${this.property().title}`,
  );

  protected readonly googleMapsUrl = computed(() => {
    const at = this.point();
    if (!at) return googleMapsSearchUrl(this.property().location);
    return this.approximate() ? googleMapsAreaUrl(at.lat, at.lng) : googleMapsPinUrl(at.lat, at.lng);
  });
}
