import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { PropertyImage } from '../../../core/properties/property.models';
import { GalleryLightbox, LightboxData } from './gallery-lightbox';

/** Hero photo with prev/next + thumbnail strip; click the hero for full screen. */
@Component({
  selector: 'app-gallery',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './gallery.html',
  styleUrl: './gallery.scss',
})
export class GalleryComponent {
  private readonly dialog = inject(MatDialog);

  readonly images = input.required<PropertyImage[]>();
  readonly title = input('');

  readonly index = signal(0);
  readonly failed = signal<ReadonlySet<number>>(new Set());
  readonly current = computed(() => this.images()[this.index()] ?? null);
  readonly count = computed(() => this.images().length);

  go(delta: number): void {
    const n = this.count();
    if (n) this.index.set((this.index() + delta + n) % n);
  }

  markFailed(id: number): void {
    this.failed.set(new Set([...this.failed(), id]));
  }

  open(): void {
    if (!this.count()) return;
    const ref = this.dialog.open<GalleryLightbox, LightboxData, number>(GalleryLightbox, {
      data: { images: this.images(), index: this.index(), title: this.title() },
      panelClass: 'lightbox-panel',
      backdropClass: 'lightbox-backdrop',
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      autoFocus: 'dialog',
    });
    // Keep the page gallery on whatever photo the user ended on.
    ref.afterClosed().subscribe((last) => {
      if (typeof last === 'number') this.index.set(last);
    });
  }
}
