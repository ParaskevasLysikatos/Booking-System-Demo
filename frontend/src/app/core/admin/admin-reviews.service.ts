import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Paginated } from '../properties/property.models';

export const ADMIN_REVIEWS_URL = `${environment.apiUrl}/admin/reviews/`;

/** One row of GET /api/admin/reviews/ (backend AdminReviewSerializer). */
export interface AdminReview {
  id: number;
  property: { id: number; title: string };
  rating: number;
  comment: string;
  author_name: string;
  guest_email: string;
  is_hidden: boolean;
  created_at: string;
}

export type ReviewVisibility = 'all' | 'visible' | 'hidden';

export interface AdminReviewQuery {
  visibility?: ReviewVisibility;
  rating?: number | null;
  property?: number | null;
  search?: string;
  page?: number;
}

/** Builds the API query string - empty values and defaults are left out. */
export function toAdminReviewParams(q: AdminReviewQuery): HttpParams {
  let params = new HttpParams();
  if (q.visibility === 'visible') params = params.set('hidden', 'false');
  if (q.visibility === 'hidden') params = params.set('hidden', 'true');
  if (q.rating) params = params.set('rating', q.rating);
  if (q.property) params = params.set('property', q.property);
  if (q.search?.trim()) params = params.set('search', q.search.trim());
  if (q.page && q.page > 1) params = params.set('page', q.page);
  return params;
}

/** Admin review moderation (TICKET-032): list everything, hide / show again. Admin-only on the server. */
@Injectable({ providedIn: 'root' })
export class AdminReviewsService {
  private readonly http = inject(HttpClient);

  list(query: AdminReviewQuery = {}): Observable<Paginated<AdminReview>> {
    return this.http.get<Paginated<AdminReview>>(ADMIN_REVIEWS_URL, { params: toAdminReviewParams(query) });
  }

  setHidden(id: number, hidden: boolean): Observable<AdminReview> {
    return this.http.patch<AdminReview>(`${ADMIN_REVIEWS_URL}${id}/`, { is_hidden: hidden });
  }
}
