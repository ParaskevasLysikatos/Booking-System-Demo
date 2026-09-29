import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Component } from '@angular/core';
import { Observable, Subject, of, throwError } from 'rxjs';

import { PropertyImageInput } from '../../../core/admin/admin-properties.service';
import { PhotoUploadService, UploadProgress } from '../../../core/admin/photo-upload.service';
import { ImagesEditorComponent, MAX_PARALLEL_UPLOADS } from './images-editor';

/** Stands in for the real service: each upload() is a Subject the test drives. */
class FakeUploader {
  enabled = false;
  readonly runs: { file: File; progress: Subject<UploadProgress> }[] = [];
  config() {
    return of({ enabled: this.enabled, max_bytes: 10485760, content_types: ['image/jpeg', 'image/png', 'image/webp'] });
  }
  upload(file: File): Observable<UploadProgress> {
    const progress = new Subject<UploadProgress>();
    this.runs.push({ file, progress });
    return progress;
  }
}

const photo = (name: string, type = 'image/jpeg') => new File(['x'], name, { type });

const a = 'https://img.test/a.jpg';
const b = 'https://img.test/b.jpg';
const c = 'https://img.test/c.jpg';

describe('ImagesEditorComponent', () => {
  function create(uploader = new FakeUploader()) {
    TestBed.configureTestingModule({
      imports: [ImagesEditorComponent],
      providers: [{ provide: PhotoUploadService, useValue: uploader }],
    });
    const fixture = TestBed.createComponent(ImagesEditorComponent);
    const cmp = fixture.componentInstance;
    const emitted: unknown[] = [];
    cmp.registerOnChange((v) => emitted.push(v));
    fixture.detectChanges();
    return { cmp, emitted, fixture, uploader };
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

  // --- uploads (TICKET-036) ---------------------------------------------------

  function withUploads() {
    const uploader = new FakeUploader();
    uploader.enabled = true;
    const env = create(uploader);
    env.fixture.detectChanges();
    return env;
  }
  const el = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement as HTMLElement;

  it('uploads off: only the URL field, no Upload button', () => {
    const { fixture, cmp } = create();
    expect(cmp.uploadsEnabled()).toBe(false);
    expect(el(fixture).querySelector('.drop')).toBeNull();
    expect(el(fixture).textContent).toContain('Photo URL');
    cmp.addFiles([photo('a.jpg')]);
    expect(cmp.uploads()).toEqual([]);
  });

  it('uploads on: drop zone with Upload photos, URL field still there', () => {
    const { fixture } = withUploads();
    const text = el(fixture).textContent ?? '';
    expect(el(fixture).querySelector('.drop')).not.toBeNull();
    expect(text).toContain('Upload photos');
    expect(text).toContain('resized to 1600 px');
    expect(text).toContain('Or paste a photo URL');
  });

  it('an upload shows progress, then joins the list (first photo = cover)', () => {
    const { cmp, uploader, emitted, fixture } = withUploads();
    cmp.addFiles([photo('beach.jpg')]);
    expect(uploader.runs.map((r) => r.file.name)).toEqual(['beach.jpg']);
    expect(cmp.uploads()[0]).toMatchObject({ name: 'beach.jpg', state: 'uploading', percent: 0 });

    uploader.runs[0].progress.next({ kind: 'progress', percent: 40 });
    fixture.detectChanges();
    expect(el(fixture).textContent).toContain('Uploading 40%');

    uploader.runs[0].progress.next({ kind: 'done', url: 'https://s3.test/property-images/x.webp' });
    expect(cmp.uploads()).toEqual([]);
    expect(emitted.at(-1)).toEqual([{ image: 'https://s3.test/property-images/x.webp', is_cover: true }]);
  });

  it(`at most ${MAX_PARALLEL_UPLOADS} at a time; the rest wait their turn`, () => {
    const { cmp, uploader } = withUploads();
    cmp.addFiles([photo('1.jpg'), photo('2.jpg'), photo('3.jpg')]);
    expect(uploader.runs.length).toBe(2);
    expect(cmp.uploads().map((u) => u.state)).toEqual(['uploading', 'uploading', 'queued']);
    uploader.runs[0].progress.next({ kind: 'done', url: 'https://s3.test/1.webp' });
    expect(uploader.runs.map((r) => r.file.name)).toEqual(['1.jpg', '2.jpg', '3.jpg']);
  });

  it('a new upload after existing photos is not the cover', () => {
    const { cmp, uploader, emitted } = withUploads();
    add(cmp, a);
    cmp.addFiles([photo('b.jpg')]);
    uploader.runs[0].progress.next({ kind: 'done', url: b });
    expect(emitted.at(-1)).toEqual([{ image: a, is_cover: true }, { image: b, is_cover: false }]);
  });

  it('non-images are skipped with a message', () => {
    const { cmp, uploader } = withUploads();
    cmp.addFiles([photo('notes.pdf', 'application/pdf'), photo('ok.png', 'image/png')]);
    expect(cmp.addError()).toBe('Not a photo, skipped: notes.pdf');
    expect(uploader.runs.map((r) => r.file.name)).toEqual(['ok.png']);
  });

  it('a failed upload shows its message; Try again restarts it; Dismiss removes it', () => {
    const { cmp, uploader, fixture } = withUploads();
    cmp.addFiles([photo('a.jpg')]);
    uploader.runs[0].progress.error(new Error('The photo storage refused the upload. Try again.'));
    fixture.detectChanges();
    expect(cmp.uploads()[0]).toMatchObject({ state: 'failed', error: 'The photo storage refused the upload. Try again.' });
    expect(el(fixture).textContent).toContain('refused the upload');

    cmp.retry(cmp.uploads()[0].id);
    expect(uploader.runs.length).toBe(2);
    uploader.runs[1].progress.error(new Error('again'));
    cmp.cancel(cmp.uploads()[0].id);
    expect(cmp.uploads()).toEqual([]);
  });

  it('cancelling a running upload unsubscribes (aborts it) and starts the next', () => {
    const { cmp, uploader } = withUploads();
    cmp.addFiles([photo('1.jpg'), photo('2.jpg'), photo('3.jpg')]);
    const first = uploader.runs[0].progress;
    cmp.cancel(cmp.uploads()[0].id);
    expect(first.observed).toBe(false);
    expect(uploader.runs.map((r) => r.file.name)).toEqual(['1.jpg', '2.jpg', '3.jpg']);
    expect(cmp.uploads().map((u) => u.name)).toEqual(['2.jpg', '3.jpg']);
  });

  it('a synchronous failure does not start anything twice', () => {
    const uploader = new FakeUploader();
    uploader.enabled = true;
    const calls: string[] = [];
    uploader.upload = (file: File) => {
      calls.push(file.name);
      return throwError(() => new Error('nope'));
    };
    const { cmp } = create(uploader);
    cmp.addFiles([photo('1.jpg'), photo('2.jpg'), photo('3.jpg')]);
    expect(calls).toEqual(['1.jpg', '2.jpg', '3.jpg']);
    expect(cmp.uploads().map((u) => u.state)).toEqual(['failed', 'failed', 'failed']);
  });

  it('drop: files are uploaded and the browser default is prevented', () => {
    const { cmp, uploader } = withUploads();
    const files = [photo('d.jpg')];
    const event = { preventDefault: vi.fn(), dataTransfer: { files, types: ['Files'] } } as unknown as DragEvent;
    cmp.onDragOver(event);
    expect(cmp.dragOver()).toBe(true);
    cmp.onDrop(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(cmp.dragOver()).toBe(false);
    expect(uploader.runs.map((r) => r.file.name)).toEqual(['d.jpg']);
  });

  it('dragging something that is not a file (e.g. a reordered row) is ignored', () => {
    const { cmp } = withUploads();
    const event = { preventDefault: vi.fn(), dataTransfer: { files: [], types: ['text/plain'] } } as unknown as DragEvent;
    cmp.onDragOver(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(cmp.dragOver()).toBe(false);
  });

  it('disabled: no uploads', () => {
    const { cmp, uploader } = withUploads();
    cmp.setDisabledState(true);
    cmp.addFiles([photo('a.jpg')]);
    expect(uploader.runs.length).toBe(0);
  });
});

@Component({
  imports: [ImagesEditorComponent, ReactiveFormsModule],
  template: `<app-images-editor [formControl]="control" />`,
})
class HostComponent {
  readonly control = new FormControl<PropertyImageInput[]>([], { nonNullable: true });
}

describe('ImagesEditorComponent in a form (TICKET-036)', () => {
  it('the control is invalid (uploading) while photos are uploading, valid again once done or failed', () => {
    const uploader = new FakeUploader();
    uploader.enabled = true;
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [{ provide: PhotoUploadService, useValue: uploader }] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const editor = fixture.debugElement.children[0].componentInstance as ImagesEditorComponent;
    const control = fixture.componentInstance.control;
    expect(control.valid).toBe(true);

    editor.addFiles([photo('a.jpg'), photo('b.jpg')]);
    expect(control.errors).toEqual({ uploading: true });
    expect(control.touched).toBe(false); // no red "wait" message until Save is pressed

    uploader.runs[0].progress.next({ kind: 'done', url: 'https://s3.test/a.webp' });
    expect(control.errors).toEqual({ uploading: true }); // b still running
    uploader.runs[1].progress.error(new Error('failed'));
    expect(control.valid).toBe(true); // a failed photo doesn't block saving
    expect(control.value).toEqual([{ image: 'https://s3.test/a.webp', is_cover: true }]);
  });
});
