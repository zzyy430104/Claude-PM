import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Api } from '../core/api';
import { AuthService } from '../core/auth.service';
import { I18n } from '../core/i18n';
import { NotificationRow, ROLE_LABELS } from '../core/models';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatBadgeModule, MatButtonModule, MatListModule, MatMenuModule, MatSidenavModule, MatToolbarModule],
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    mat-sidenav-container { flex: 1; min-height: 0; }
    mat-sidenav { width: 220px; }
    .spacer { flex: 1; }
    .who { font-size: 14px; margin: 0 8px; }
    .n-title { font-weight: 500; } .n-body { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .unread { font-weight: 600; }
  `,
  template: `
    <mat-toolbar>
      <span>Claude-PM</span>
      <span class="spacer"></span>
      @if (!auth.hasRole('PLATFORM_ADMIN')) {
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
      <span class="who">{{ auth.user()?.name }}（{{ roleLabel() }}）</span>
      <button mat-button (click)="i18n.toggle()" [attr.aria-label]="i18n.t('语言')">{{ i18n.lang() === 'en' ? '中文' : 'EN' }}</button>
      <button mat-button (click)="auth.logout()">{{ i18n.t('退出') }}</button>
    </mat-toolbar>
    <mat-sidenav-container>
      <mat-sidenav mode="side" opened>
        <mat-nav-list>
          <a mat-list-item routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">首页</a>
          @if (!auth.hasRole('PLATFORM_ADMIN')) {
            <a mat-list-item routerLink="/projects" routerLinkActive="active">项目</a>
          }
          @if (auth.hasRole('TENANT_ADMIN', 'TOP_MANAGEMENT', 'PROJECT_MANAGER', 'FUNCTION_MANAGER')) {
            <a mat-list-item routerLink="/tenders" routerLinkActive="active">投标</a>
          }
          @if (!auth.hasRole('PLATFORM_ADMIN')) {
            <a mat-list-item routerLink="/lessons" routerLinkActive="active">经验教训库</a>
          }
          @if (auth.hasRole('TENANT_ADMIN')) {
            <a mat-list-item routerLink="/templates" routerLinkActive="active">阶段模板</a>
          }
          @if (auth.hasRole('TENANT_ADMIN', 'TOP_MANAGEMENT')) {
            <a mat-list-item routerLink="/users" routerLinkActive="active">用户管理</a>
            <a mat-list-item routerLink="/audit" routerLinkActive="active">审计日志</a>
          }
          @if (auth.hasRole('PLATFORM_ADMIN')) {
            <a mat-list-item routerLink="/tenants" routerLinkActive="active">租户管理</a>
          }
        </mat-nav-list>
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
