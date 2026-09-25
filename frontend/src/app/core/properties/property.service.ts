import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { toIsoDate } from '../dates';
import { DEFAULT_PAGE_SIZE, PageRequest, Paginated, PropertyFilters, PropertySummary } from './property.models';

export const PROPERTIES_URL = `${environment.apiUrl}/properties/`;

/** Builds the API query string from filters - empty values are left out. */
export function toPropertyParams(filters: PropertyFilters, page?: PageRequest): HttpParams {
  let params = new HttpParams();
  const set = (key: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
  };
  set('location', filters.location?.trim());
  set('guests', filters.guests);
  set('min_price', filters.minPrice);
  set('max_price', filters.maxPrice);
  if (filters.checkIn && filters.checkOut) {
    set('check_in', toIsoDate(filters.checkIn));
    set('check_out', toIsoDate(filters.checkOut));
  }
  if (filters.ordering && filters.ordering !== 'newest') set('ordering', filters.ordering);
  if (page) {
    if (page.page > 1) set('page', page.page);
    if (page.pageSize !== DEFAULT_PAGE_SIZE) set('page_size', page.pageSize);
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class PropertyService {
  private readonly http = inject(HttpClient);

  /**
   * The public listings: active properties only. Guests only ever get
   * active ones anyway; `is_active=true` makes an admin browsing the shop
   * front see the same thing (the admin table in TICKET-024 lists all).
   */
  list(filters: PropertyFilters, page: PageRequest): Observable<Paginated<PropertySummary>> {
    const params = toPropertyParams(filters, page).set('is_active', 'true');
    return this.http.get<Paginated<PropertySummary>>(PROPERTIES_URL, { params });
  }
}
