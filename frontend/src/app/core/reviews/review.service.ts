import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { PROPERTIES_URL } from '../properties/property.service';
import { CreateReviewRequest, Review, ReviewPage } from './review.models';

export const REVIEWS_URL = `${environment.apiUrl}/reviews/`;

/** Reviews API (TICKET-032) - see the README's "Reviews API" section. */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly http = inject(HttpClient);

  /** A property's visible reviews, newest first, 5 per page, plus the star summary. */
  forProperty(propertyId: number, page = 1): Observable<ReviewPage> {
    const params = page > 1 ? new HttpParams().set('page', page) : undefined;
    return this.http.get<ReviewPage>(`${PROPERTIES_URL}${propertyId}/reviews/`, { params });
  }

  /** Post the caller's review - allowed once per property, after a confirmed stay has ended. Final. */
  create(body: CreateReviewRequest): Observable<Review> {
    return this.http.post<Review>(REVIEWS_URL, body);
  }
}
