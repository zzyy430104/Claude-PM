import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, REFRESH_LOCK } from './auth.service';

describe('AuthService.refresh 跨标签页加锁', () => {
  let ctrl: HttpTestingController;
  let auth: AuthService;
  const original = Object.getOwnPropertyDescriptor(navigator, 'locks');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    ctrl = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    ctrl.verify();
    if (original) Object.defineProperty(navigator, 'locks', original);
    else delete (navigator as unknown as { locks?: unknown }).locks;
  });

  it('有 Web Locks 时在锁内发刷新请求', async () => {
    const names: string[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (name: string, cb: () => Promise<unknown>) => {
          names.push(name);
          return cb();
        },
      },
    });
    const p = auth.refresh();
    expect(names).toEqual([REFRESH_LOCK]);
    ctrl.expectOne('/api/auth/refresh').flush({ accessToken: 'new' });
    expect(await p).toBe(true);
    expect(auth.accessToken).toBe('new');
  });

  it('同一标签页并发调用只发一次请求', async () => {
    const a = auth.refresh();
    const b = auth.refresh();
    expect(a).toBe(b);
    ctrl.expectOne('/api/auth/refresh').flush({ accessToken: 'x' });
    expect(await a).toBe(true);
  });

  it('刷新失败返回 false', async () => {
    const p = auth.refresh();
    ctrl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await p).toBe(false);
  });
});
