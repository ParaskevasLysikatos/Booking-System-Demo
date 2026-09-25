import { TestBed } from '@angular/core/testing';

import { ImagesEditorComponent } from './images-editor';

const a = 'https://img.test/a.jpg';
const b = 'https://img.test/b.jpg';
const c = 'https://img.test/c.jpg';

describe('ImagesEditorComponent', () => {
  function create() {
    TestBed.configureTestingModule({ imports: [ImagesEditorComponent] });
    const fixture = TestBed.createComponent(ImagesEditorComponent);
    const cmp = fixture.componentInstance;
    const emitted: unknown[] = [];
    cmp.registerOnChange((v) => emitted.push(v));
    fixture.detectChanges();
    return { cmp, emitted, fixture };
  }
  const add = (cmp: ImagesEditorComponent, url: string) => {
    cmp.url.setValue(url);
    cmp.add();
  };
  const covers = (cmp: ImagesEditorComponent) => cmp.images().filter((i) => i.is_cover).map((i) => i.image);

  it('adds URLs; the first photo becomes the cover', () => {
    const { cmp, emitted } = create();
    add(cmp, a);
    add(cmp, b);
    expect(cmp.images().map((i) => i.image)).toEqual([a, b]);
    expect(covers(cmp)).toEqual([a]);
    expect(emitted.at(-1)).toEqual([{ image: a, is_cover: true }, { image: b, is_cover: false }]);
    expect(cmp.url.value).toBe('');
  });

  it('rejects non-URLs and duplicates with a message', () => {
    const { cmp } = create();
    add(cmp, 'not a url');
    expect(cmp.addError()).toContain('http');
    add(cmp, a);
    add(cmp, a);
    expect(cmp.addError()).toContain('already');
    expect(cmp.images().length).toBe(1);
  });

  it('exactly one cover: setCover moves it; removing the cover passes it on', () => {
    const { cmp } = create();
    [a, b, c].forEach((u) => add(cmp, u));
    cmp.setCover(2);
    expect(covers(cmp)).toEqual([c]);
    cmp.remove(2);
    expect(covers(cmp)).toEqual([a]);
  });

  it('drag and drop reorders', () => {
    const { cmp, emitted } = create();
    [a, b, c].forEach((u) => add(cmp, u));
    cmp.drop({ previousIndex: 2, currentIndex: 0 } as never);
    expect(cmp.images().map((i) => i.image)).toEqual([c, a, b]);
    expect(emitted.length).toBe(4);
  });

  it('writeValue normalises the cover (none -> first; several -> first flagged)', () => {
    const { cmp } = create();
    cmp.writeValue([{ image: a, is_cover: false }, { image: b, is_cover: false }]);
    expect(covers(cmp)).toEqual([a]);
    cmp.writeValue([{ image: a, is_cover: false }, { image: b, is_cover: true }, { image: c, is_cover: true }]);
    expect(covers(cmp)).toEqual([b]);
  });
});
