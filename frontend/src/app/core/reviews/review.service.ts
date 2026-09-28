import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { PROPERTIES_URL } from '../properties/property.service';
import { ReviewPage } from './review.models';

/** Reviews API (TICKET-032) - see the README's "Reviews API" section. */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly http = inject(HttpClient);

  /** A property's visible reviews, newest first, 5 per page, plus the star summary. */
  forProperty(propertyId: number, page = 1): Observable<ReviewPage> {
    const params = page > 1 ? new HttpParams().set('page', page) : undefined;
    return this.http.get<ReviewPage>(`${PROPERTIES_URL}${propertyId}/reviews/`, { params });
  }
}
