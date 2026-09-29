import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../i18n/translate.pipe';

/** iPhone/iPad: Safari can't be asked to install, so we show the manual steps (TICKET-031). */
@Component({
  selector: 'app-install-ios-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'installIos.title' | t }}</h2>
    <mat-dialog-content>
      <ol>
        <li>{{ 'installIos.tap' | t }} <strong>{{ 'installIos.share' | t }}</strong> <mat-icon aria-hidden="true">ios_share</mat-icon> {{ 'installIos.inToolbar' | t }}</li>
        <li>{{ 'installIos.choose' | t }} <strong>{{ 'installIos.addToHome' | t }}</strong> <mat-icon aria-hidden="true">add_box</mat-icon> {{ 'installIos.scrollHint' | t }}</li>
        <li>{{ 'installIos.tap' | t }} <strong>{{ 'installIos.add' | t }}</strong>.</li>
      </ol>
      <p>{{ 'installIos.after' | t }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close cdkFocusInitial>{{ 'installIos.gotIt' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
    mat-icon { font-size: 20px; width: 20px; height: 20px; vertical-align: -4px; color: var(--mat-sys-primary); }
    p { margin: 16px 0 0; color: var(--mat-sys-on-surface-variant); }
  `,
})
export class InstallIosDialog {}
