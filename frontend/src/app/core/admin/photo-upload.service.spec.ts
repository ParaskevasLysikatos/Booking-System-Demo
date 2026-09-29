import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ImageResizer, UnreadablePhotoError } from './image-resize';
import {
  MAX_ORIGINAL_BYTES,
  PhotoUploadService,
  PresignedUpload,
  UPLOADS_CONFIG_URL,
  UPLOADS_PRESIGN_URL,
  UploadProgress,
  s3ErrorCode,
} from './photo-upload.service';

const S3_URL = 'https://demo-bucket.s3.eu-central-1.amazonaws.com/';
const KEY = 'property-images/2026/09/abc.webp';
const PUBLIC_URL = S3_URL + KEY;

function signed(): PresignedUpload {
  return {
    url: S3_URL,
    fields: { 'Content-Type': 'image/webp', 'Cache-Control': 'public', key: KEY, policy: 'p', 'x-amz-signature': 's' },
    key: KEY,
    public_url: PUBLIC_URL,
    expires_in: 300,
    max_bytes: 10485760,
  };
}

const tick = () => new Promise((r) => setTimeout(r));

describe('PhotoUploadService (TICKET-036)', () => {
  let http: HttpTestingController;
  let service: PhotoUploadService;
  let resize: ReturnType<typeof vi.fn>;
  const resized = new Blob(['x'.repeat(300)], { type: 'image/webp' });

  beforeEach(() => {
    resize = vi.fn(async () => ({ blob: resized, type: 'image/webp', width: 1600, height: 1200 }));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ImageResizer, useValue: { resize } }],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(PhotoUploadService);
  });

  function start(file = new File(['original'], 'beach.jpg', { type: 'image/jpeg' })) {
    const events: UploadProgress[] = [];
    let error: Error | null = null;
    let completed = false;
    const sub = service.upload(file).subscribe({
      next: (e) => events.push(e),
      error: (e: Error) => (error = e),
      complete: () => (completed = true),
    });
    return { events, sub, error: () => error, completed: () => completed, file };
  }

  it('config: asked once and shared; any error means uploads are off', () => {
    const seen: boolean[] = [];
    service.config().subscribe((c) => seen.push(c.enabled));
    service.config().subscribe((c) => seen.push(c.enabled));
    http.expectOne(UPLOADS_CONFIG_URL).flush({ enabled: true, max_bytes: 1, content_types: [] });
    expect(seen).toEqual([true, true]);
    expect(UPLOADS_CONFIG_URL).toMatch(/\/api\/admin\/uploads\/config\/$/);
  });

  it('config error -> disabled', () => {
    let enabled: boolean | undefined;
    service.config().subscribe((c) => (enabled = c.enabled));
    http.expectOne(UPLOADS_CONFIG_URL).flush({ detail: 'x' }, { status: 403, statusText: 'Forbidden' });
    expect(enabled).toBe(false);
  });

  it('resizes, presigns with the resized type and size, posts the form to S3 with the file last, reports progress', async () => {
    const run = start();
    await tick();
    expect(resize).toHaveBeenCalledWith(run.file);

    const presign = http.expectOne({ url: UPLOADS_PRESIGN_URL, method: 'POST' });
    expect(presign.request.body).toEqual({ content_type: 'image/webp', size: 300 });
    presign.flush(signed());

    const s3 = http.expectOne({ url: S3_URL, method: 'POST' });
    expect(s3.request.reportProgress).toBe(true);
    expect(s3.request.responseType).toBe('text');
    expect(s3.request.headers.has('Authorization')).toBe(false);
    const form = s3.request.body as FormData;
    expect(Array.from(form.keys())).toEqual(['Content-Type', 'Cache-Control', 'key', 'policy', 'x-amz-signature', 'file']);
    expect(form.get('key')).toBe(KEY);
    const file = form.get('file') as File;
    expect(file.size).toBe(300);
    expect(file.name).toBe('beach.jpg');

    s3.event({ type: HttpEventType.UploadProgress, loaded: 150, total: 300 });
    s3.event({ type: HttpEventType.UploadProgress, loaded: 300, total: 300 });
    s3.flush('', { status: 204, statusText: 'No Content' });

    expect(run.events).toEqual([
      { kind: 'progress', percent: 50 },
      { kind: 'progress', percent: 99 }, // 100% only once S3 has answered
      { kind: 'done', url: PUBLIC_URL },
    ]);
    expect(run.completed()).toBe(true);
    expect(run.error()).toBeNull();
  });

  it('too large to even open -> refused before resizing', () => {
    const big = new File([], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: MAX_ORIGINAL_BYTES + 1 });
    const run = start(big);
    expect(run.error()?.message).toContain('over 40 MB');
    expect(resize).not.toHaveBeenCalled();
  });

  it('unreadable photo -> its message, nothing sent', async () => {
    resize.mockRejectedValueOnce(new UnreadablePhotoError());
    const run = start();
    await tick();
    expect(run.error()?.message).toBe("Couldn't read this photo. Use a JPEG, PNG or WebP image.");
    http.expectNone(UPLOADS_PRESIGN_URL);
  });

  it("presign refused -> the API's own message", async () => {
    const run = start();
    await tick();
    http.expectOne(UPLOADS_PRESIGN_URL).flush(
      { detail: 'Photo uploads are switched off. Paste an image URL instead.', code: 'uploads_disabled' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    expect(run.error()?.message).toBe('Photo uploads are switched off. Paste an image URL instead.');
  });

  it('presign field error -> the field message', async () => {
    const run = start();
    await tick();
    http.expectOne(UPLOADS_PRESIGN_URL).flush({ size: ['Photos can be at most 10 MB.'] }, { status: 400, statusText: 'Bad Request' });
    expect(run.error()?.message).toBe('Photos can be at most 10 MB.');
  });

  it('presign throttled -> wait message', async () => {
    const run = start();
    await tick();
    http.expectOne(UPLOADS_PRESIGN_URL).flush({ detail: 'Request was throttled.' }, { status: 429, statusText: 'Too Many' });
    expect(run.error()?.message).toContain('Wait a minute');
  });

  async function failAtS3(body: string, status: number) {
    const run = start();
    await tick();
    http.expectOne(UPLOADS_PRESIGN_URL).flush(signed());
    const s3 = http.expectOne(S3_URL);
    if (status === 0) s3.error(new ProgressEvent('error'), { status: 0, statusText: '' });
    else s3.flush(body, { status, statusText: 'Error' });
    return run.error()?.message;
  }

  it('S3 errors -> readable messages', async () => {
    expect(await failAtS3('<Error><Code>EntityTooLarge</Code></Error>', 400)).toContain('too large');
    expect(await failAtS3('<Error><Code>AccessDenied</Code><Message>Invalid according to Policy: Policy expired.</Message></Error>', 403)).toContain(
      'took too long',
    );
    expect(await failAtS3('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', 403)).toContain('access denied');
    expect(await failAtS3('', 0)).toContain('CORS');
    expect(await failAtS3('<Error><Code>InternalError</Code></Error>', 500)).toBe('The photo storage refused the upload. Try again.');
  });

  it('unsubscribing aborts the S3 request', async () => {
    const run = start();
    await tick();
    http.expectOne(UPLOADS_PRESIGN_URL).flush(signed());
    const s3 = http.expectOne(S3_URL);
    run.sub.unsubscribe();
    expect(s3.cancelled).toBe(true);
  });

  it('s3ErrorCode reads the XML code', () => {
    expect(s3ErrorCode('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>')).toBe('AccessDenied');
    expect(s3ErrorCode('nope')).toBeNull();
    expect(s3ErrorCode(null)).toBeNull();
  });
});
