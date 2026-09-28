import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { InstallService } from './core/pwa/install.service';
import { FooterComponent } from './layout/footer/footer';
import { ToolbarComponent } from './layout/toolbar/toolbar';
import { WakeNoticeComponent } from './layout/wake-notice/wake-notice';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToolbarComponent, WakeNoticeComponent, FooterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  // Created here, at start-up, so the browser's one-off "can be installed"
  // event is caught before the toolbar needs it (TICKET-031).
  private readonly install = inject(InstallService);
}
