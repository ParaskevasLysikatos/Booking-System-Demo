import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { GalleryComponent } from './gallery';

const images = [1, 2, 3].map((id) => ({ id, image: `https://img.test/${id}.jpg`, is_cover: id === 1 }));

describe('GalleryComponent', () => {
  function create(imgs = images) {
    TestBed.configureTestingModule({ imports: [GalleryComponent] });
    const fixture = TestBed.createComponent(GalleryComponent);
    fixture.componentRef.setInput('images', imgs);
    fixture.componentRef.setInput('title', 'Loft');
    fixture.detectChanges();
    return fixture;
  }

  it('prev/next wrap around and thumbnails select', () => {
    const fixture = create();
    const g = fixture.componentInstance;
    g.go(-1);
    expect(g.index()).toBe(2);
    g.go(1);
    expect(g.index()).toBe(0);
    g.index.set(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hero img').getAttribute('src')).toBe('https://img.test/2.jpg');
    expect(fixture.nativeElement.querySelector('.counter').textContent.trim()).toBe('2 / 3');
  });

  it('opens the full-screen viewer at the current photo and keeps the photo it closed on', () => {
    const fixture = create();
    const dialog = TestBed.inject(MatDialog);
    const open = vi.spyOn(dialog, 'open').mockReturnValue({ afterClosed: () => of(2) } as never);
    fixture.componentInstance.index.set(1);
    fixture.componentInstance.open();
    expect(open.mock.calls[0][1]?.data).toEqual({ images, index: 1, title: 'Loft' });
    expect(fixture.componentInstance.index()).toBe(2);
  });

  it('shows placeholders for no photos / broken photos', () => {
    let fixture = create([]);
    expect(fixture.nativeElement.textContent).toContain('No photos yet');
    TestBed.resetTestingModule();
    fixture = create();
    fixture.componentInstance.markFailed(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hero .placeholder')).not.toBeNull();
  });
});
