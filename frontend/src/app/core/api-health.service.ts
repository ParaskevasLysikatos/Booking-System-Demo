import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

export interface HealthResponse {
  status: string;
  database: string;
}

@Injectable({ providedIn: 'root' })
export class ApiHealthService {
  constructor(private http: HttpClient) {}

  check(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>(`${environment.apiUrl}/health/`);
  }
}
