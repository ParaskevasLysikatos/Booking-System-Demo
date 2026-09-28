import { TestBed } from '@angular/core/testing';

import { StarRatingComponent, starIcons } from './star-rating';

describe('starIcons', () => {
  it('rounds to the nearest half star', () => {
    expect(starIcons(5)).toEqual(['star', 'star', 'star', 'star', 'star']);
    expect(starIcons(4.3)).toEqual(['star', 'star', 'star', 'star', 'star_half']);
    expect(starIcons(4.2)).toEqual(['star', 'star', 'star', 'star', 'star_border']);
    expect(starIcons(1)).toEqual(['star', 'star_border', 'star_border', 'star_border', 'star_border']);
    expect(starIcons(0)).toEqual(Array(5).fill('star_border'));
    expect(starIcons(9)).toEqual(Array(5).fill('star')); // clamped
  });
});

describe('StarRatingComponent', () => {
  it('is one image for screen readers, labelled with the rating', () => {
    const fixture = TestBed.createComponent(StarRatingComponent);
    fixture.componentRef.setInput('rating', 4.25);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector('[role="img"]')!;
    expect(el.getAttribute('aria-label')).toBe('4.3 out of 5 stars');
    expect(el.querySelectorAll('mat-icon[aria-hidden="true"]').length).toBe(5);
  });
});
