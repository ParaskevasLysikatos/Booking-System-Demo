/**
 * Pure pieces of the shared map (TICKET-034) - no Leaflet import here, so
 * they're cheap to use and to test.
 */

/** One thing on the map. */
export interface MapMarker<T = unknown> {
  id: number | string;
  lat: number;
  lng: number;
  /** Accessible name and hover title, e.g. "Cozy Loft in Chania, €126 a night". */
  title: string;
  /** Text of a price tag (e.g. "€126"). Without it the marker is a round pin. */
  label?: string;
  /**
   * Draw a shaded circle of this radius (metres) instead of a marker - the
   * "approximate location" area guests see (API `location_radius_m`).
   */
  areaRadiusM?: number | null;
  /** Anything the page wants back in markerSelect / the pop-up template. */
  data?: T;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * CARTO Voyager raster tiles (agreed for TICKET-034): a light, low-contrast
 * base map so the price tags stand out. Free, no API key; built on
 * OpenStreetMap data, so both are credited.
 */
export const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
export const TILE_SUBDOMAINS = 'abcd';
export const TILE_MAX_ZOOM = 20;
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

/** What the map shows when there's nothing to fit to: all of Greece. */
export const GREECE_VIEW = { center: { lat: 38.6, lng: 23.9 } as LatLng, zoom: 6 };

/** Zoom used for a single point, and the most fitBounds may zoom in. */
export const DEFAULT_MAX_FIT_ZOOM = 15;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inner HTML of a marker: a price tag, or a round pin without a label. */
export function markerHtml(marker: Pick<MapMarker, 'label'>): string {
  return marker.label
    ? `<span class="app-map-price">${escapeHtml(marker.label)}</span>`
    : '<span class="app-map-pin"></span>';
}

/** Inner HTML of a cluster bubble ("12"). */
export function clusterHtml(count: number): string {
  return `<span class="app-map-cluster">${count}</span>`;
}

/** Screen-reader name of a cluster bubble. */
export function clusterTitle(count: number): string {
  return `${count} stays here - zoom in`;
}

/** Only markers with usable coordinates (the API sends null when a place has no position). */
export function withPosition<T>(markers: readonly MapMarker<T>[]): MapMarker<T>[] {
  return markers.filter(
    (m) =>
      typeof m.lat === 'number' && typeof m.lng === 'number' &&
      Number.isFinite(m.lat) && Number.isFinite(m.lng) &&
      Math.abs(m.lat) <= 90 && Math.abs(m.lng) <= 180,
  );
}
