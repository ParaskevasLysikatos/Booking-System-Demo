import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { REVIEWS_URL } from '../core/reviews/review.service';
import { ReviewDialog } from './review-dialog';

describe('ReviewDialog', () => {
  let fixture: ComponentFixture<ReviewDialog>;
  let http: HttpTestingController;
  let dialogRef: { close: ReturnType<typeof vi.fn>; disableClose: boolean };

  function create() {
    dialogRef = { close: vi.fn(), disableClose: false };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { propertyId: 5, propertyTitle: 'Harbour Loft' } },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ReviewDialog);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const star = (n: number) => el().querySelectorAll<HTMLInputElement>('input[type="radio"]')[n - 1];
  const submit = () => {
    (el().querySelector('button[type="submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  function type(value: string) {
    const area = el().querySelector('textarea')!;
    area.value = value;
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('asks about the stay, has 5 labelled star radios and says reviews are final', () => {
    create();
    expect(text()).toContain('How was your stay at Harbour Loft?');
    expect(Array.from(el().querySelectorAll('input[type="radio"]')).map((i) => i.getAttribute('aria-label'))).toEqual([
      '1 star - Terrible', '2 stars - Poor', '3 stars - Okay', '4 stars - Good', '5 stars - Excellent',
    ]);
    expect(text()).toContain("Reviews are final: once posted you can't edit or delete it.");
  });

  it('a rating is required - nothing is sent without one', () => {
    create();
    submit();
    expect(text()).toContain('Choose a rating from 1 to 5 stars.');
    http.expectNone(REVIEWS_URL);
  });

  it('picking stars lights them and shows the word; the comment has a counter', () => {
    create();
    star(4).click();
    fixture.detectChanges();
    expect(el().querySelectorAll('label.on').length).toBe(4);
    expect(text()).toContain('Good');
    type('Nice');
    expect(text()).toContain('4 / 1000');
  });

  it('posts rating + trimmed comment, blocks closing meanwhile, closes with the review', () => {
    create();
    star(5).click();
    type('  Lovely view  ');
    submit();
    const req = http.expectOne(REVIEWS_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ property: 5, rating: 5, comment: 'Lovely view' });
    expect(dialogRef.disableClose).toBe(true);
    expect(el().querySelector('[aria-label="Posting your review"]')).toBeTruthy();
    const review = { id: 9, rating: 5, comment: 'Lovely view', author_name: 'Maria K.', created_at: '' };
    req.flush(review);
    expect(dialogRef.close).toHaveBeenCalledWith(review);
  });

  it("a refusal is shown in the dialog, which stays open so the guest can close it", () => {
    create();
    star(3).click();
    submit();
    http.expectOne(REVIEWS_URL).flush({ non_field_errors: ["You've already reviewed this place."] }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(text()).toContain("You've already reviewed this place.");
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(dialogRef.disableClose).toBe(false);
    expect((el().querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a comment error from the server shows under the comment', () => {
    create();
    star(2).click();
    submit();
    http.expectOne(REVIEWS_URL).flush({ comment: ['Ensure this field has no more than 1000 characters.'] }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(el().querySelector('.field-error')!.textContent).toContain('no more than 1000 characters');
  });

  it('in Greek (TICKET-038): question, star labels, note and buttons', () => {
    localStorage.setItem('bsd.lang', 'el');
    create();
    expect(text()).toContain('Πώς ήταν η διαμονή σας στο Harbour Loft;');
    expect(Array.from(el().querySelectorAll('input[type="radio"]')).map((i) => i.getAttribute('aria-label'))).toEqual([
      '1 αστέρι - Απαίσια', '2 αστέρια - Κακή', '3 αστέρια - Μέτρια', '4 αστέρια - Καλή', '5 αστέρια - Εξαιρετική',
    ]);
    expect(text()).toContain('Οι κριτικές είναι οριστικές');
    expect(text()).toContain('Δημοσίευση κριτικής');
    localStorage.clear();
  });
});
