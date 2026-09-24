import { Component, OnInit, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ApiHealthService } from '../core/api-health.service';

type Status = 'checking' | 'ok' | 'error';

@Component({
  selector: 'app-api-status',
  imports: [MatCardModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './api-status.html',
  styleUrl: './api-status.scss',
})
export class ApiStatusComponent implements OnInit {
  status = signal<Status>('checking');
  databaseStatus = signal<string>('');
  errorMessage = signal<string>('');

  constructor(private apiHealth: ApiHealthService) {}

  ngOnInit(): void {
    this.apiHealth.check().subscribe({
      next: (res) => {
        this.status.set('ok');
        this.databaseStatus.set(res.database);
      },
      error: (err) => {
        this.status.set('error');
        this.errorMessage.set('Could not reach the backend at ' + err.url);
      },
    });
  }
}
