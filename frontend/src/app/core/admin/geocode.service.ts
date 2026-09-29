import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export const GEOCODE_URL = `${environment.apiUrl}/admin/geocode/`;

/** How exact a place is (backend listings/geocoding.py, from Nominatim's place_rank). */
export type GeocodePrecision = 'address' | 'street' | 'area' | 'city';

export interface GeocodeResult {
  /** Nominatim's full address line. */
  label: string;
  /** Short form for "Placed at …", e.g. "Ιωάννη Τσιμισκή, Ladadika, Thessaloniki" (TICKET-042). */
  short_label: string;
  name: string;
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
  kind: string;
}

/** GET /api/admin/geocode/?q= (TICKET-034 step 3): up to 5 places in Greece, best first. */
export interface GeocodeResponse {
  query: string;
  results: GeocodeResult[];
  attribution: string;
}

export const PRECISION_LABELS: Record<GeocodePrecision, string> = {
  address: 'exact address',
  street: 'street',
  area: 'neighbourhood / village',
  city: 'town centre',
};

/** Admin-only place search behind the property form's "Find on map". */
@Injectable({ providedIn: 'root' })
export class GeocodeService {
  private readonly http = inject(HttpClient);

  search(query: string): Observable<GeocodeResponse> {
    return this.http.get<GeocodeResponse>(GEOCODE_URL, { params: new HttpParams().set('q', query.trim()) });
  }
}
