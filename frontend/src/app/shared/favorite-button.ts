import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { FavoriteService, FavoriteTarget } from '../core/favorites/favorite.service';

/**
 * The heart (TICKET-033). A toggle button (`aria-pressed`) with a fixed
 * label, "Save <title>", so screen readers announce "Save Harbour Loft,
 * toggle button, pressed" / "not pressed".
 *
 * - `overlay` - round white button for the corner of a card photo.
 * - `labeled` - heart + "Save" / "Saved", for the property page header.
 *
 * Not rendered for admin accounts. Everything else (optimistic update,
 * errors, logged-out -> login -> save) lives in FavoriteService.
 */
@Component({
  selector: 'app-favorite-button',
  imports: [MatButtonModule, MatIconModule],
  template: `
    @if (favorites.available()) {
      @if (variant() === 'overlay') {
        <button
          type="button"
          class="heart overlay"
          [class.saved]="saved()"
          [attr.aria-pressed]="saved()"
          [attr.aria-label]="label()"
          [attr.aria-busy]="busy() || null"
          [title]="saved() ? 'Saved' : 'Save'"
          (click)="toggle($event)"
        >
          <mat-icon aria-hidden="true">{{ saved() ? 'favorite' : 'favorite_border' }}</mat-icon>
        </button>
      } @else {
        <button
          mat-button
          type="button"
          class="heart labeled"
          [class.saved]="saved()"
          [attr.aria-pressed]="saved()"
          [attr.aria-label]="label()"
          [attr.aria-busy]="busy() || null"
          (click)="toggle($event)"
        >
          <mat-icon aria-hidden="true">{{ saved() ? 'favorite' : 'favorite_border' }}</mat-icon>
          <span aria-hidden="true">{{ saved() ? 'Saved' : 'Save' }}</span>
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: inline-block;
    }

    .heart mat-icon {
      transition: transform 0.15s ease;
    }

    .heart.saved mat-icon {
      color: var(--app-heart, #e0245e);
    }

    .heart:active mat-icon {
      transform: scale(0.85);
    }

    .overlay {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgb(255 255 255 / 92%);
      color: #222;
      box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
      cursor: pointer;

      &:hover {
        background: #fff;
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    .labeled {
      min-height: 44px;

      mat-icon {
        margin-right: 4px;
      }
    }
  `,
})
export class FavoriteButtonComponent {
  protected readonly favorites = inject(FavoriteService);

  readonly property = input.required<FavoriteTarget>();
  readonly variant = input<'overlay' | 'labeled'>('overlay');

  protected readonly saved = computed(() => this.favorites.isSaved(this.property()));
  protected readonly busy = computed(() => this.favorites.isBusy(this.property().id));
  protected readonly label = computed(() => `Save ${this.property().title}`);

  protected toggle(event: Event): void {
    // Never let the tap reach a surrounding link or card.
    event.preventDefault();
    event.stopPropagation();
    this.favorites.toggle(this.property());
  }
}
