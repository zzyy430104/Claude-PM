import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login').then((m) => m.LoginPage),
  },
  {
    path: 'signup',
    loadComponent: () => import('./pages/signup').then((m) => m.SignupPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./pages/home').then((m) => m.HomePage),
      },
      {
        path: 'users',
        canActivate: [roleGuard('TENANT_ADMIN', 'TOP_MANAGEMENT')],
        loadComponent: () => import('./pages/users').then((m) => m.UsersPage),
      },
      {
        path: 'audit',
        canActivate: [roleGuard('TENANT_ADMIN', 'TOP_MANAGEMENT')],
        loadComponent: () => import('./pages/audit').then((m) => m.AuditPage),
      },
      {
        path: 'tenants',
        canActivate: [roleGuard('PLATFORM_ADMIN')],
        loadComponent: () => import('./pages/tenants').then((m) => m.TenantsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
