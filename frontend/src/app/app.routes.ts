import { Routes } from '@angular/router';

import { authGuard, guestOnlyGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  // Listings are the home page (TICKET-018).
  { path: '', pathMatch: 'full', redirectTo: 'listings' },
  {
    path: 'listings',
    title: 'Stays · Booking System Demo',
    loadComponent: () => import('./pages/listings/listings').then((m) => m.PropertyListPage),
  },
  {
    path: 'listings/:id',
    // No static `title`: the router would reset it on every query-param
    // change - the page sets the property's own title instead.
    loadComponent: () => import('./pages/property-detail/property-detail').then((m) => m.PropertyDetailPage),
  },
  {
    path: 'booking/:propertyId',
    // Title set by the page (a static one would be re-applied on every query change).
    canActivate: [authGuard], // logged out -> /login?returnUrl=... and back here after
    loadComponent: () => import('./pages/booking/booking').then((m) => m.BookingFormPage),
  },
  {
    path: 'my-bookings',
    title: 'My bookings · Booking System Demo',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/my-bookings/my-bookings').then((m) => m.MyBookingsPage),
  },
  {
    path: 'login',
    title: 'Log in · Booking System Demo',
    canActivate: [guestOnlyGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: 'Sign up · Booking System Demo',
    canActivate: [guestOnlyGuard],
    loadComponent: () => import('./pages/register/register').then((m) => m.RegisterPage),
  },
  { path: '**', redirectTo: 'listings' },
];
