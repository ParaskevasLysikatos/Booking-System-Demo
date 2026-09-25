import { TestBed } from '@angular/core/testing';

import { AmenitiesPickerComponent } from './amenities-picker';

describe('AmenitiesPickerComponent', () => {
  function create() {
    TestBed.configureTestingModule({ imports: [AmenitiesPickerComponent] });
    const fixture = TestBed.createComponent(AmenitiesPickerComponent);
    const cmp = fixture.componentInstance;
    const emitted: string[][] = [];
    cmp.registerOnChange((v) => emitted.push(v));
    fixture.detectChanges();
    return { cmp, emitted, fixture };
  }

  it('keeps a stable order: known amenities first (checklist order), then custom', () => {
    const { cmp } = create();
    cmp.writeValue(['hot_tub', 'tv', 'wifi', 'wifi']);
    expect(cmp.selected()).toEqual(['wifi', 'tv', 'hot_tub']);
    expect(cmp.customKeys()).toEqual(['hot_tub']);
  });

  it('toggles checkboxes and adds custom amenities as keys', () => {
    const { cmp, emitted, fixture } = create();
    cmp.toggle('pool', true);
    cmp.custom.setValue('Sea-view terrace');
    cmp.addCustom();
    cmp.custom.setValue('sea view terrace'); // same key -> not added twice
    cmp.addCustom();
    expect(emitted.at(-1)).toEqual(['pool', 'sea_view_terrace']);
    cmp.toggle('pool', false);
    expect(cmp.selected()).toEqual(['sea_view_terrace']);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sea view terrace');
  });
});
