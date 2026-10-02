import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Api } from '../core/api';
import { AuthService } from '../core/auth.service';
import { Brand } from '../core/brand';
import { I18n } from '../core/i18n';
import { MyApprovalRoles, NotificationRow, ROLE_LABELS } from '../core/models';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatBadgeModule, MatButtonModule, MatMenuModule, MatSidenavModule, MatToolbarModule],
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    mat-toolbar { background: var(--pm-nav); color: #e9eef2; height: 56px; padding: 0 20px; gap: 4px; }
    mat-toolbar .brand { font-weight: 800; font-size: 17px; letter-spacing: .02em; white-space: nowrap; }
    mat-toolbar .company { font-size: 13px; color: #9fb0bf; margin-left: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    mat-toolbar button { color: #e9eef2; }
    mat-sidenav-container { flex: 1; min-height: 0; background: var(--pm-bg); }
    mat-sidenav { border-radius: 0; width: 220px; background: var(--pm-bg); border-right: 1px solid var(--pm-line); padding: 14px 12px; }
    nav { display: flex; flex-direction: column; gap: 16px; }
    .grp { display: flex; flex-direction: column; gap: 2px; }
    .grp h6 { margin: 0 0 4px 12px; font-size: 12px; color: var(--pm-muted); font-weight: 700; letter-spacing: .08em; }
    mat-sidenav a { display: block; padding: 9px 12px; border-radius: 10px; color: var(--pm-text); text-decoration: none; font-size: 15px; }
    mat-sidenav a:hover { background: var(--pm-bg-2); }
    mat-sidenav a.active { background: var(--pm-primary-soft); color: var(--pm-primary); font-weight: 700; }
    .spacer { flex: 1; }
    .who { font-size: 14px; margin: 0 10px; color: #e9eef2; text-decoration: none; padding: 6px 8px; border-radius: 8px; white-space: nowrap; } .who:hover { background: rgba(255,255,255,.08); text-decoration: none; }
    .who em { font-style: normal; color: #9fb0bf; margin-left: 6px; font-size: 13px; }
    .n-title { font-weight: 500; } .n-body { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .unread { font-weight: 600; }
    @media (max-width: 760px) {
      mat-toolbar .company, .who em { display: none; }
      mat-toolbar { padding: 0 6px; gap: 0; }
      mat-toolbar .brand { font-size: 15px; }
      mat-toolbar .mat-mdc-button { min-width: 0; padding: 0 8px; }
      .menu-btn { font-size: 20px; }
      .who { margin: 0 2px; padding: 6px 4px; max-width: 5em; overflow: hidden; text-overflow: ellipsis; }
      mat-sidenav { width: 240px; }
    }
  `,
  template: `
    <mat-toolbar>
      @if (mobile()) { <button mat-button class="menu-btn" type="button" (click)="nav.toggle()" [attr.aria-label]="i18n.t('菜单')">☰</button> }
      <span class="brand">{{ brand.systemName() }}</span>
      @if (brand.companyName()) { <span class="company">{{ brand.companyName() }}</span> }
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
      <mat-sidenav #nav [mode]="mobile() ? 'over' : 'side'" [opened]="!mobile()">
        <nav aria-label="主菜单" (click)="mobile() && nav.close()">
          @if (!auth.hasRole('PLATFORM_ADMIN')) {
            <div class="grp">
              <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">我的工作台</a>
              @if (showInitiations()) { <a routerLink="/initiations" routerLinkActive="active">立项管理</a> }
              <a routerLink="/projects" routerLinkActive="active">项目</a>
              <a routerLink="/enterprise-risks" routerLinkActive="active">企业风险</a>
              <a routerLink="/evaluations" routerLinkActive="active">绩效评价单</a>
              @if (auth.hasRole('TENANT_ADMIN', 'TOP_MANAGEMENT', 'PROJECT_MANAGER', 'FUNCTION_MANAGER')) {
                <a routerLink="/resources" routerLinkActive="active">资源</a>
              }
            </div>
            <div class="grp">
              <h6>知识库</h6>
              <a routerLink="/lessons" routerLinkActive="active">经验教训</a>
              @if (auth.hasRole('TENANT_ADMIN')) { <a routerLink="/templates" routerLinkActive="active">模板</a> }
            </div>
            @if (auth.hasRole('TENANT_ADMIN', 'TOP_MANAGEMENT')) {
              <div class="grp">
                <h6>管理</h6>
                <a routerLink="/users" routerLinkActive="active">用户与角色</a>
                @if (auth.hasRole('TENANT_ADMIN')) { <a routerLink="/settings" routerLinkActive="active">企业设置</a> }
                <a routerLink="/audit" routerLinkActive="active">审计</a>
              </div>
            }
          } @else {
            <div class="grp"><a routerLink="/tenants" routerLinkActive="active">租户管理</a></div>
          }
        </nav>
      </mat-sidenav>
      <mat-sidenav-content><router-outlet /></mat-sidenav-content>
    </mat-sidenav-container>
  `,
})
export class Shell {
  /** 手机：菜单收起，点左上角 ☰ 打开 */
  private readonly mq = window.matchMedia('(max-width: 760px)');
  readonly mobile = signal(this.mq.matches);
  constructor() { this.mq.addEventListener('change', (e) => this.mobile.set(e.matches)); }
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18n);
  readonly brand = inject(Brand);
  readonly unread = signal(0);
  readonly list = signal<NotificationRow[]>([]);
  /** 立项管理菜单：企业管理员、最高管理层，以及被指定为立项申请人、批准人、会签人的用户 */
  readonly showInitiations = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly roleLabel = computed(() => {
    const u = this.auth.user();
    return u ? this.i18n.t(ROLE_LABELS[u.role]) : '';
  });

  ngOnInit() {
    if (this.auth.hasRole('PLATFORM_ADMIN')) return;
    void this.brand.load();
    void this.loadApprovalRoles();
    void this.refreshCount();
    this.timer = setInterval(() => void this.refreshCount(), 60_000);
  }
  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async loadApprovalRoles() {
    if (this.auth.hasRole('TENANT_ADMIN', 'TOP_MANAGEMENT')) { this.showInitiations.set(true); return; }
    try {
      const m = await this.api.get<MyApprovalRoles>('/approval-roles/mine');
      this.showInitiations.set(m.initiator || m.approver || m.cosigner);
    } catch { /* 改密码前等情况下取不到，不显示 */ }
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
