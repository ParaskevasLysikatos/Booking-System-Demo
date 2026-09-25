import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the brand and Log in / Sign up when logged out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Booking System Demo');
    expect(text).toContain('Log in');
    expect(text).toContain('Sign up');
    expect(text).not.toContain('My bookings');
  });

  it('shows the email and Log out when a session is stored', async () => {
    localStorage.setItem('bsd.user', JSON.stringify({ id: 1, email: 'maria@example.com', role: 'guest' }));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('maria@example.com');
    expect(text).toContain('My bookings');
    expect(text).toContain('Log out');
  });
});
