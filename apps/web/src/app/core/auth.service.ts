import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CurrentUser, Role } from './models';

export const API = '/api';

/** 刷新令牌接口要求的自定义请求头，与后端约定一致，用于防跨站请求伪造 */
export const CSRF_HEADERS = { 'X-Requested-With': 'claude-pm' };

/** 跨标签页刷新令牌用的锁名 */
export const REFRESH_LOCK = 'claude-pm-auth-refresh';

/**
 * 登录状态：
 *  - 访问令牌只保存在内存里，页面刷新后由刷新令牌换回
 *  - 刷新令牌由服务端放在 httpOnly Cookie 中，页面脚本读不到，因此即使页面出现脚本注入漏洞也无法窃取
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly user = signal<CurrentUser | null>(null);
  readonly isLoggedIn = computed(() => this.user() !== null);
  private token: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  get accessToken(): string | null {
    return this.token;
  }

  hasRole(...roles: Role[]): boolean {
    const u = this.user();
    return !!u && roles.includes(u.role);
  }

  /** 应用启动时：用刷新令牌 Cookie 换回访问令牌，恢复登录状态（没有 Cookie 就保持未登录） */
  async restore(): Promise<void> {
    if (!(await this.refresh())) return;
    try {
      await this.loadMe();
    } catch {
      this.clear();
    }
  }

  async login(body: { tenantSlug?: string; email: string; password: string }) {
    const res = await firstValueFrom(this.http.post<{ accessToken: string }>(`${API}/auth/login`, body));
    this.token = res.accessToken;
    await this.loadMe();
  }

  async signup(body: {
    tenantName: string;
    tenantSlug: string;
    adminEmail: string;
    adminName: string;
    password: string;
  }) {
    await firstValueFrom(this.http.post(`${API}/auth/signup`, body));
  }

  /** 修改本人密码：成功后服务端作废其他设备的登录，并为当前会话发新令牌 */
  async changePassword(currentPassword: string, newPassword: string) {
    const res = await firstValueFrom(
      this.http.post<{ accessToken: string }>(`${API}/auth/change-password`, { currentPassword, newPassword }),
    );
    this.token = res.accessToken;
    await this.loadMe();
  }

  /**
   * 多个并发请求同时 401 时只发一次刷新；
   * 多个标签页之间用 Web Locks 排队，同一时间只有一个标签页在刷新，后面的标签页会带着已更新的 Cookie 再刷新
   */
  refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const doRefresh = () =>
      firstValueFrom(this.http.post<{ accessToken: string }>(`${API}/auth/refresh`, {}, { headers: CSRF_HEADERS }));
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const call: Promise<{ accessToken: string }> = locks
      ? (locks.request(REFRESH_LOCK, doRefresh) as unknown as Promise<{ accessToken: string }>)
      : doRefresh();
    this.refreshing = call
      .then((r) => {
        this.token = r.accessToken;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async logout() {
    try {
      if (this.token) await firstValueFrom(this.http.post(`${API}/auth/logout`, {}));
    } catch {
      /* 令牌已失效也照常清理本地状态 */
    }
    this.clear();
    await this.router.navigateByUrl('/login');
  }

  /** 令牌彻底失效时由拦截器调用 */
  expire() {
    this.clear();
    void this.router.navigateByUrl('/login');
  }

  private async loadMe() {
    this.user.set(await firstValueFrom(this.http.get<CurrentUser>(`${API}/me`)));
  }

  private clear() {
    this.token = null;
    this.user.set(null);
  }
}
