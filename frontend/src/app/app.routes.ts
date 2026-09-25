import { Routes } from '@angular/router';

import { guestOnlyGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: '',
    title: 'Booking System Demo',
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
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
  { path: '**', redirectTo: '' },
];
