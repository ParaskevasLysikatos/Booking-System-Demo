import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { FooterComponent } from './layout/footer/footer';
import { ToolbarComponent } from './layout/toolbar/toolbar';
import { WakeNoticeComponent } from './layout/wake-notice/wake-notice';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToolbarComponent, WakeNoticeComponent, FooterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
