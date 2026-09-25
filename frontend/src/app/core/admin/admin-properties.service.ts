import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { PROPERTIES_URL } from '../properties/property.service';
import { Paginated, PropertyDetail, PropertyOrdering, PropertySummary } from '../properties/property.models';

export type PropertyStatusFilter = 'all' | 'active' | 'retired';

export interface AdminPropertyQuery {
  status?: PropertyStatusFilter;
  search?: string;
  ordering?: PropertyOrdering;
  page?: number;
  pageSize?: number;
}

export interface PropertyImageInput {
  image: string;
  is_cover: boolean;
}

/** Body for POST / PATCH /api/properties/ (admin only). Sending `images` replaces the whole set. */
export interface PropertyWrite {
  title: string;
  description: string;
  location: string;
  price_per_night: string;
  capacity: number;
  amenities: string[];
  is_active: boolean;
  images: PropertyImageInput[];
}

/**
 * Admin side of /api/properties/ (TICKET-024). Unlike the public
 * PropertyService (always active-only), this lists everything an admin can
 * see, and writes. The backend's IsAdminOrReadOnly is what actually
 * allows the writes.
 */
@Injectable({ providedIn: 'root' })
export class AdminPropertiesService {
  private readonly http = inject(HttpClient);

  list(query: AdminPropertyQuery = {}): Observable<Paginated<PropertySummary>> {
    let params = new HttpParams();
    if (query.status === 'active') params = params.set('is_active', 'true');
    if (query.status === 'retired') params = params.set('is_active', 'false');
    if (query.search?.trim()) params = params.set('search', query.search.trim());
    if (query.ordering && query.ordering !== 'newest') params = params.set('ordering', query.ordering);
    if (query.page && query.page > 1) params = params.set('page', query.page);
    if (query.pageSize) params = params.set('page_size', query.pageSize);
    return this.http.get<Paginated<PropertySummary>>(PROPERTIES_URL, { params });
  }

  get(id: number): Observable<PropertyDetail> {
    return this.http.get<PropertyDetail>(`${PROPERTIES_URL}${id}/`);
  }

  create(body: PropertyWrite): Observable<PropertyDetail> {
    return this.http.post<PropertyDetail>(PROPERTIES_URL, body);
  }

  update(id: number, body: Partial<PropertyWrite>): Observable<PropertyDetail> {
    return this.http.patch<PropertyDetail>(`${PROPERTIES_URL}${id}/`, body);
  }

  /** DELETE is a soft delete on the backend: is_active=false, history kept. */
  retire(id: number): Observable<void> {
    return this.http.delete<void>(`${PROPERTIES_URL}${id}/`);
  }

  reactivate(id: number): Observable<PropertyDetail> {
    return this.update(id, { is_active: true });
  }
}
