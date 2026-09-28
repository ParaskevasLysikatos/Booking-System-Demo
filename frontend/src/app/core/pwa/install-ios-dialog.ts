import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

/** iPhone/iPad: Safari can't be asked to install, so we show the manual steps (TICKET-031). */
@Component({
  selector: 'app-install-ios-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Install the app</h2>
    <mat-dialog-content>
      <ol>
        <li>Tap <strong>Share</strong> <mat-icon aria-hidden="true">ios_share</mat-icon> in the browser's toolbar.</li>
        <li>Choose <strong>Add to Home Screen</strong> <mat-icon aria-hidden="true">add_box</mat-icon> (scroll down if you don't see it).</li>
        <li>Tap <strong>Add</strong>.</li>
      </ol>
      <p>The app then opens full-screen from its icon, like any other app.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close cdkFocusInitial>Got it</button>
    </mat-dialog-actions>
  `,
  styles: `
    ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
    mat-icon { font-size: 20px; width: 20px; height: 20px; vertical-align: -4px; color: var(--mat-sys-primary); }
    p { margin: 16px 0 0; color: var(--mat-sys-on-surface-variant); }
  `,
})
export class InstallIosDialog {}
