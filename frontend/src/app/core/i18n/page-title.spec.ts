import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { PageTitle } from './page-title';
import { TranslationService } from './translation.service';

@Component({ template: '' })
class Plain {}

/** Like the property page: no route title, sets its own from data. */
@Component({ template: '' })
class OwnTitle {
  constructor() {
    inject(PageTitle).set(() => 'Seaside loft');
  }
}

describe('PageTitle (TICKET-038)', () => {
  let router: RouterTestingHarness;
  let title: Title;
  let i18n: TranslationService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', title: 'titles.login', component: Plain },
          { path: 'legacy', title: 'Plain text title', component: Plain },
          { path: 'own', component: OwnTitle },
          { path: 'untitled', component: Plain },
        ]),
        { provide: TitleStrategy, useExisting: PageTitle },
      ],
    });
    router = await RouterTestingHarness.create(); // has an outlet, so pages are really created
    title = TestBed.inject(Title);
    i18n = TestBed.inject(TranslationService);
  });
  afterEach(() => localStorage.clear());

  it('turns a route title key into "<page> · Booking System Demo", rebuilt on a switch', async () => {
    await router.navigateByUrl('/login');
    expect(title.getTitle()).toBe('Log in · Booking System Demo');
    i18n.setLang('el');
    expect(title.getTitle()).toBe('Σύνδεση · Booking System Demo');
  });

  it('keeps a plain-text route title as it is', async () => {
    await router.navigateByUrl('/legacy');
    expect(title.getTitle()).toBe('Plain text title · Booking System Demo');
  });

  it("keeps a page's own title (set before the router's update) and rebuilds it on a switch", async () => {
    await router.navigateByUrl('/login');
    await router.navigateByUrl('/own');
    expect(title.getTitle()).toBe('Seaside loft · Booking System Demo');
    i18n.setLang('el');
    expect(title.getTitle()).toBe('Seaside loft · Booking System Demo');
  });

  it('setKey translates, and follows a switch', () => {
    const pageTitle = TestBed.inject(PageTitle);
    pageTitle.setKey('titles.myBookings');
    expect(title.getTitle()).toBe('My bookings · Booking System Demo');
    i18n.setLang('el');
    expect(title.getTitle()).toBe('Οι κρατήσεις μου · Booking System Demo');
  });

  it("a page without a title of its own: a switch doesn't bring back the previous page's title", async () => {
    await router.navigateByUrl('/login');
    title.setTitle('Set by the page directly');
    await router.navigateByUrl('/untitled');
    i18n.setLang('el');
    expect(title.getTitle()).toBe('Set by the page directly');
  });
});
