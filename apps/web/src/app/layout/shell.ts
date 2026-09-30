import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Api } from '../core/api';
import { AuthService } from '../core/auth.service';
import { I18n } from '../core/i18n';
import { NotificationRow, ROLE_LABELS } from '../core/models';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatBadgeModule, MatButtonModule, MatMenuModule, MatSidenavModule, MatToolbarModule],
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    mat-toolbar { background: var(--pm-nav); color: #fff; height: 56px; padding: 0 20px; gap: 4px; }
    mat-toolbar .mark { width: 30px; height: 30px; font-size: 13px; margin-right: 10px; }
    mat-toolbar .brand { font-weight: 600; font-size: 16px; }
    mat-toolbar button { color: #dbe4ee; }
    mat-sidenav-container { flex: 1; min-height: 0; background: var(--pm-bg); }
    mat-sidenav { border-radius: 0; width: 208px; background: var(--pm-card); border-right: 1px solid var(--pm-line); padding-top: 8px; }
    mat-sidenav a { display: block; margin: 2px 10px; padding: 9px 14px; border-radius: 8px; color: var(--pm-text); text-decoration: none; font-weight: 500; }
    mat-sidenav a:hover { background: var(--pm-bg); }
    mat-sidenav a.active { background: #dbe5f0; color: var(--pm-primary-strong); }
    .spacer { flex: 1; }
    .who { font-size: 13px; margin: 0 10px; color: #dbe4ee; text-decoration: none; padding: 6px 8px; border-radius: 8px; } .who:hover { background: rgba(255,255,255,.08); text-decoration: none; }
    .who em { font-style: normal; background: rgba(255,255,255,.14); padding: 2px 8px; border-radius: 999px; margin-left: 8px; font-size: 12px; }
    .n-title { font-weight: 500; } .n-body { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .unread { font-weight: 600; }
  `,
  template: `
    <mat-toolbar>
      <span class="mark">PM</span><span class="brand">Claude-PM</span>
      <span class="spacer"></span>
      @if (!auth.hasRole('PLATFORM_ADMIN') && !auth.user()?.mustChangePassword) {
        <button mat-button [matMenuTriggerFor]="menu" (menuOpened)="loadList()" [attr.aria-label]="i18n.t('通知')">
          {{ i18n.t('通知') }} <span [matBadge]="unread()" [matBadgeHidden]="unread() === 0" matBadgeOverlap="false" matBadgeSize="small"></span>
        </button>
        <mat-menu #menu="matMenu">
          @for (n of list(); track n.id) {
            <button mat-menu-item (click)="open(n)">
              <span>
                <span class="n-title" [class.unread]="!n.readAt">{{ n.title }}</span><br />
                <span class="n-body">{{ n.body }}</span>
              </span>
            </button>
          }
          @if (list().length === 0) { <button mat-menu-item disabled>{{ i18n.t('暂无通知') }}</button> }
          @if (unread() > 0) { <button mat-menu-item (click)="readAll()">{{ i18n.t('全部已读') }}</button> }
        </mat-menu>
      }
      <a class="who" routerLink="/account" [attr.title]="i18n.t('个人设置')">{{ auth.user()?.name }}<em>{{ roleLabel() }}</em></a>
      <button mat-button (click)="i18n.toggle()" [attr.aria-label]="i18n.t('语言')">{{ i18n.lang() === 'en' ? '中文' : 'EN' }}</button>
      <button mat-button (click)="auth.logout()">{{ i18n.t('退出') }}</button>
    </mat-toolbar>
    <mat-sidenav-container>
      <mat-sidenav mode="side" opened>
        <nav>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">首页</a>
          @if (!auth.hasRole('PLATFORM_ADMIN')) {
            <a routerLink="/projects" routerLinkActive="active">项目</a>
          }
          @if (auth.hasRole('TENANT_ADMIN', 'TOP_MANAGEMENT', 'PROJECT_MANAGER', 'FUNCTION_MANAGER')) {
            <a routerLink="/tenders" routerLinkActive="active">投标</a>
          }
          @if (!auth.hasRole('PLATFORM_ADMIN')) {
            <a routerLink="/lessons" routerLinkActive="active">经验教训库</a>
          }
          @if (auth.hasRole('TENANT_ADMIN')) {
            <a routerLink="/templates" routerLinkActive="active">阶段模板</a>
          }
          @if (auth.hasRole('TENANT_ADMIN', 'TOP_MANAGEMENT')) {
            <a routerLink="/users" routerLinkActive="active">用户管理</a>
            <a routerLink="/audit" routerLinkActive="active">审计日志</a>
          }
          @if (auth.hasRole('PLATFORM_ADMIN')) {
            <a routerLink="/tenants" routerLinkActive="active">租户管理</a>
          }
        </nav>
      </mat-sidenav>
      <mat-sidenav-content><router-outlet /></mat-sidenav-content>
    </mat-sidenav-container>
  `,
})
export class Shell {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18n);
  readonly unread = signal(0);
  readonly list = signal<NotificationRow[]>([]);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly roleLabel = computed(() => {
    const u = this.auth.user();
    return u ? this.i18n.t(ROLE_LABELS[u.role]) : '';
  });

  ngOnInit() {
    if (this.auth.hasRole('PLATFORM_ADMIN')) return;
    void this.refreshCount();
    this.timer = setInterval(() => void this.refreshCount(), 60_000);
  }
  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async refreshCount() {
    try { this.unread.set((await this.api.get<{ count: number }>('/notifications/count')).count); } catch { /* 网络暂时不可用时忽略 */ }
  }
  async loadList() {
    this.list.set((await this.api.get<NotificationRow[]>('/notifications')).slice(0, 10));
  }
  async open(n: NotificationRow) {
    if (!n.readAt) await this.api.post(`/notifications/${n.id}/read`);
    await this.refreshCount();
    if (n.link) await this.router.navigateByUrl(n.link);
  }
  async readAll() {
    await this.api.post('/notifications/read-all');
    this.list.update((l) => l.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    await this.refreshCount();
  }
}
