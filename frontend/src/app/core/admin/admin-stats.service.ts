import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { toIsoDate } from '../dates';
import { AdminStats } from './admin-stats.models';

export const ADMIN_STATS_URL = `${environment.apiUrl}/admin/stats/`;

@Injectable({ providedIn: 'root' })
export class AdminStatsService {
  private readonly http = inject(HttpClient);

  /** Stats for the nights from..to (both inclusive, max 366 days - the API's limit). Admin only (403 otherwise). */
  getStats(from: Date, to: Date): Observable<AdminStats> {
    const params = new HttpParams().set('from', toIsoDate(from)).set('to', toIsoDate(to));
    return this.http.get<AdminStats>(ADMIN_STATS_URL, { params });
  }
}
