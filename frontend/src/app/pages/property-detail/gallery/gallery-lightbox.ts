import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { PropertyImage } from '../../../core/properties/property.models';

export interface LightboxData {
  images: PropertyImage[];
  index: number;
  title: string;
}

/** Full-screen photo viewer: arrows / ← → keys / swipe, Esc or ✕ to close. */
@Component({
  selector: 'app-gallery-lightbox',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="lightbox" (touchstart)="touchStart($event)" (touchend)="touchEnd($event)">
      <button mat-icon-button class="close" type="button" (click)="close()" aria-label="Close"><mat-icon>close</mat-icon></button>
      <img [src]="current().image" [alt]="data.title + ' - photo ' + (index() + 1)" />
      @if (data.images.length > 1) {
        <button mat-icon-button class="nav prev" type="button" (click)="go(-1)" aria-label="Previous photo"><mat-icon>chevron_left</mat-icon></button>
        <button mat-icon-button class="nav next" type="button" (click)="go(1)" aria-label="Next photo"><mat-icon>chevron_right</mat-icon></button>
      }
      <p class="caption">{{ data.title }} · {{ index() + 1 }} / {{ data.images.length }}</p>
    </div>
  `,
  styles: `
    .lightbox { position: relative; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; background: #000; color: #fff; }
    img { max-width: 100%; max-height: calc(100vh - 80px); object-fit: contain; user-select: none; }
    button { color: #fff; }
    .close { position: absolute; top: 12px; right: 12px; }
    .nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgb(255 255 255 / 12%); }
    .prev { left: 12px; } .next { right: 12px; }
    .caption { position: absolute; bottom: 12px; margin: 0; font-size: 14px; opacity: 0.85; }
  `,
})
export class GalleryLightbox {
  readonly data = inject<LightboxData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<GalleryLightbox, number>);

  readonly index = signal(this.data.index);
  readonly current = computed(() => this.data.images[this.index()]);
  private touchX: number | null = null;

  constructor() {
    // Close through close() on Esc / backdrop too, so the gallery behind
    // can stay on the photo the user ended on.
    this.ref.disableClose = true;
    this.ref.keydownEvents().subscribe((e) => e.key === 'Escape' && this.close());
    this.ref.backdropClick().subscribe(() => this.close());
  }

  go(delta: number): void {
    const n = this.data.images.length;
    this.index.set((this.index() + delta + n) % n);
  }

  close(): void {
    this.ref.close(this.index());
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') this.go(-1);
    else if (event.key === 'ArrowRight') this.go(1);
  }

  touchStart(event: TouchEvent): void {
    this.touchX = event.changedTouches[0]?.clientX ?? null;
  }

  touchEnd(event: TouchEvent): void {
    if (this.touchX === null) return;
    const dx = (event.changedTouches[0]?.clientX ?? this.touchX) - this.touchX;
    if (Math.abs(dx) > 40) this.go(dx < 0 ? 1 : -1);
    this.touchX = null;
  }
}
