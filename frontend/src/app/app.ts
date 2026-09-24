import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ApiStatusComponent } from './api-status/api-status';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ApiStatusComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = 'Booking System Demo';
}
