import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    // 访问令牌只在内存里：模拟已经登录
    (auth as unknown as { token: string }).token = 'old-access';
  });

  afterEach(() => ctrl.verify());

  it('令牌不写入 localStorage / sessionStorage（防脚本注入窃取）', () => {
    expect(JSON.stringify(localStorage)).not.toContain('old-access');
    expect(JSON.stringify(sessionStorage)).not.toContain('old-access');
  });

  it('给业务请求带上访问令牌', () => {
    http.get('/api/users').subscribe();
    const req = ctrl.expectOne('/api/users');
    expect(req.request.headers.get('Authorization')).toBe('Bearer old-access');
    req.flush([]);
  });

  it('登录接口不带令牌', () => {
    http.post('/api/auth/login', {}).subscribe();
    const req = ctrl.expectOne('/api/auth/login');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('401 时刷新令牌并用新令牌重试', async () => {
    let result: unknown;
    http.get('/api/users').subscribe((r) => (result = r));
    ctrl.expectOne('/api/users').flush({}, { status: 401, statusText: 'Unauthorized' });

    await Promise.resolve();
    const refresh = ctrl.expectOne('/api/auth/refresh');
    // 刷新令牌在 httpOnly Cookie 里，请求体为空，但必须带 CSRF 请求头
    expect(refresh.request.body).toEqual({});
    expect(refresh.request.headers.get('X-Requested-With')).toBe('claude-pm');
    refresh.flush({ accessToken: 'new-access' });

    await new Promise((r) => setTimeout(r));
    const retry = ctrl.expectOne('/api/users');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-access');
    retry.flush(['ok']);
    expect(result).toEqual(['ok']);
    expect(JSON.stringify(localStorage)).not.toContain('new-access');
  });

  it('刷新失败时清理登录状态并抛出原错误', async () => {
    const expire = vi.spyOn(auth, 'expire').mockImplementation(() => undefined);
    let status = 0;
    http.get('/api/users').subscribe({ error: (e) => (status = e.status) });
    ctrl.expectOne('/api/users').flush({}, { status: 401, statusText: 'Unauthorized' });

    await Promise.resolve();
    ctrl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });

    await new Promise((r) => setTimeout(r));
    expect(expire).toHaveBeenCalled();
    expect(status).toBe(401);
  });

  it('非 401 错误原样抛出，不触发刷新', () => {
    let status = 0;
    http.get('/api/users').subscribe({ error: (e) => (status = e.status) });
    ctrl.expectOne('/api/users').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(status).toBe(403);
    ctrl.expectNone('/api/auth/refresh');
  });
});
