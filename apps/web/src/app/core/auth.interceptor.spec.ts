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
    localStorage.clear();
    localStorage.setItem('pm.access', 'old-access');
    localStorage.setItem('pm.refresh', 'old-refresh');
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
  });

  afterEach(() => ctrl.verify());

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
    expect(refresh.request.body).toEqual({ refreshToken: 'old-refresh' });
    refresh.flush({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    await new Promise((r) => setTimeout(r));
    const retry = ctrl.expectOne('/api/users');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-access');
    retry.flush(['ok']);
    expect(result).toEqual(['ok']);
    expect(localStorage.getItem('pm.refresh')).toBe('new-refresh');
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
