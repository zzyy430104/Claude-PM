import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from '../core/auth.service';
import { ROLE_LABELS } from '../core/models';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatListModule, MatSidenavModule, MatToolbarModule],
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    mat-sidenav-container { flex: 1; min-height: 0; }
    mat-sidenav { width: 220px; }
    .spacer { flex: 1; }
    .who { font-size: 14px; margin-right: 8px; }
  `,
  template: `
    <mat-toolbar>
      <span>Claude-PM</span>
      <span class="spacer"></span>
      <span class="who">{{ auth.user()?.name }}（{{ roleLabel() }}）</span>
      <button mat-button (click)="auth.logout()">退出</button>
    </mat-toolbar>
    <mat-sidenav-container>
      <mat-sidenav mode="side" opened>
        <mat-nav-list>
          <a mat-list-item routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">首页</a>
          @if (!auth.hasRole('PLATFORM_ADMIN')) {
            <a mat-list-item routerLink="/projects" routerLinkActive="active">项目</a>
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
  readonly auth = inject(AuthService);
  readonly roleLabel = computed(() => {
    const u = this.auth.user();
    return u ? ROLE_LABELS[u.role] : '';
  });
}
