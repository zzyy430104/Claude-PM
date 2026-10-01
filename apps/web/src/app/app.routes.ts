import { Routes } from '@angular/router';
import { authGuard, passwordGuard, roleGuard } from './core/guards';

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
    canActivateChild: [passwordGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./pages/home').then((m) => m.HomePage),
      },
      {
        path: 'initiations',
        loadComponent: () => import('./pages/initiations').then((m) => m.InitiationsPage),
      },
      {
        path: 'initiations/new',
        loadComponent: () => import('./pages/initiation').then((m) => m.InitiationPage),
      },
      {
        path: 'initiations/:id',
        loadComponent: () => import('./pages/initiation').then((m) => m.InitiationPage),
      },
      {
        path: 'projects',
        loadComponent: () => import('./pages/projects').then((m) => m.ProjectsPage),
      },
      {
        path: 'projects/:id/report',
        loadComponent: () => import('./pages/report').then((m) => m.ReportPage),
      },
      {
        path: 'projects/:id',
        loadComponent: () => import('./pages/project-detail').then((m) => m.ProjectDetailPage),
      },
      {
        path: 'lessons',
        loadComponent: () => import('./pages/knowledge').then((m) => m.KnowledgePage),
      },
      {
        path: 'templates',
        canActivate: [roleGuard('TENANT_ADMIN')],
        loadComponent: () => import('./pages/templates').then((m) => m.TemplatesPage),
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
        path: 'evaluations',
        loadComponent: () => import('./pages/evaluations').then((m) => m.EvaluationsPage),
      },
      {
        path: 'enterprise-risks',
        loadComponent: () => import('./pages/enterprise-risks').then((m) => m.EnterpriseRisksPage),
      },
      {
        path: 'resources',
        canActivate: [roleGuard('TENANT_ADMIN', 'TOP_MANAGEMENT', 'PROJECT_MANAGER', 'FUNCTION_MANAGER')],
        loadComponent: () => import('./pages/resources').then((m) => m.ResourcesPage),
      },
      {
        path: 'settings',
        canActivate: [roleGuard('TENANT_ADMIN')],
        loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage),
      },
      {
        path: 'account',
        loadComponent: () => import('./pages/account').then((m) => m.AccountPage),
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
