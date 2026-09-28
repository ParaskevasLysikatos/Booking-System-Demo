import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type StarIcon = 'star' | 'star_half' | 'star_border';

/** Five icons for a 0-5 rating, rounded to the nearest half star. */
export function starIcons(rating: number): StarIcon[] {
  const halves = Math.round(Math.min(5, Math.max(0, rating)) * 2);
  return Array.from({ length: 5 }, (_, i) => (halves >= (i + 1) * 2 ? 'star' : halves === i * 2 + 1 ? 'star_half' : 'star_border'));
}

/**
 * Read-only stars (TICKET-032), e.g. ★★★★½ for 4.3. One image for screen
 * readers ("4.3 out of 5 stars"); the icons themselves are hidden from them.
 */
@Component({
  selector: 'app-star-rating',
  imports: [MatIconModule],
  template: `
    <span class="stars" role="img" [attr.aria-label]="label()" [style.--star-size.px]="size()">
      @for (icon of icons(); track $index) {
        <mat-icon aria-hidden="true">{{ icon }}</mat-icon>
      }
    </span>
  `,
  styles: `
    .stars { display: inline-flex; vertical-align: middle; color: #f5a623; }
    mat-icon { font-size: var(--star-size); width: var(--star-size); height: var(--star-size); }
  `,
})
export class StarRatingComponent {
  readonly rating = input.required<number>();
  readonly size = input(18);

  readonly icons = computed(() => starIcons(this.rating()));
  readonly label = computed(() => {
    const r = Math.round(this.rating() * 10) / 10;
    return `${r} out of 5 stars`;
  });
}
