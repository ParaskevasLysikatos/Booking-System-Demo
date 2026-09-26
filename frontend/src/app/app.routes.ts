import { Routes } from '@angular/router';

import { adminGuard, authGuard, guestOnlyGuard } from './core/auth/auth.guards';
import { unsavedChangesGuard } from './core/unsaved-changes.guard';

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
    // Where Stripe sends the guest back after paying (?session_id=...) or
    // backing out (?cancelled=1) - TICKET-029. Title set by the page.
    path: 'bookings/:id/payment',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/payment-return/payment-return').then((m) => m.PaymentReturnPage),
  },
  {
    path: 'my-bookings',
    title: 'My bookings · Booking System Demo',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/my-bookings/my-bookings').then((m) => m.MyBookingsPage),
  },
  {
    // Admin area (TICKET-022): one guard for the whole group - logged out ->
    // login; not an admin -> /forbidden. Navigation only; the API enforces roles.
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/admin/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard · Admin · Booking System Demo',
        loadComponent: () => import('./pages/admin/dashboard/dashboard').then((m) => m.AdminDashboardPage),
      },
      {
        path: 'properties',
        title: 'Properties · Admin · Booking System Demo',
        loadComponent: () => import('./pages/admin/properties/admin-property-list').then((m) => m.AdminPropertyListPage),
      },
      {
        path: 'properties/new',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./pages/admin/properties/property-form').then((m) => m.PropertyFormPage),
      },
      {
        path: 'properties/:id/edit',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./pages/admin/properties/property-form').then((m) => m.PropertyFormPage),
      },
      {
        path: 'bookings',
        title: 'Bookings · Admin · Booking System Demo',
        loadComponent: () => import('./pages/admin/bookings/admin-bookings').then((m) => m.AdminBookingsPage),
      },
    ],
  },
  {
    path: 'forbidden',
    title: 'Admins only · Booking System Demo',
    loadComponent: () => import('./pages/forbidden/forbidden').then((m) => m.ForbiddenPage),
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
