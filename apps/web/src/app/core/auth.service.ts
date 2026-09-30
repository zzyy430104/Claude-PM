import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CurrentUser, Role, Tokens } from './models';

export const API = '/api';
const ACCESS_KEY = 'pm.access';
const REFRESH_KEY = 'pm.refresh';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下忽略 */
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly user = signal<CurrentUser | null>(null);
  readonly isLoggedIn = computed(() => this.user() !== null);
  private refreshing: Promise<boolean> | null = null;

  get accessToken(): string | null {
    return read(ACCESS_KEY);
  }

  hasRole(...roles: Role[]): boolean {
    const u = this.user();
    return !!u && roles.includes(u.role);
  }

  /** 应用启动时：若有令牌则恢复登录状态 */
  async restore(): Promise<void> {
    if (!this.accessToken && !read(REFRESH_KEY)) return;
    try {
      await this.loadMe();
    } catch {
      this.clear();
    }
  }

  async login(body: { tenantSlug?: string; email: string; password: string }) {
    const tokens = await firstValueFrom(
      this.http.post<Tokens>(`${API}/auth/login`, body),
    );
    this.store(tokens);
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

  /** 多个并发请求同时 401 时只发一次刷新 */
  refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const refreshToken = read(REFRESH_KEY);
    if (!refreshToken) return Promise.resolve(false);
    this.refreshing = firstValueFrom(
      this.http.post<Tokens>(`${API}/auth/refresh`, { refreshToken }),
    )
      .then((t) => {
        this.store(t);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async logout() {
    const refreshToken = read(REFRESH_KEY);
    try {
      if (this.accessToken) {
        await firstValueFrom(
          this.http.post(`${API}/auth/logout`, { refreshToken }),
        );
      }
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

  private store(t: Tokens) {
    write(ACCESS_KEY, t.accessToken);
    write(REFRESH_KEY, t.refreshToken);
  }

  private clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
    this.user.set(null);
  }
}
