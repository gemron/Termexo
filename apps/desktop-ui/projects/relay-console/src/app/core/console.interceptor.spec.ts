import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { LOGIN_ENDPOINT } from './console-api.service';
import { consoleInterceptor } from './console.interceptor';
import { SessionService } from './session.service';

describe('consoleInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([consoleInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
    TestBed.resetTestingModule();
  });

  it('sends the session cookie with every call', () => {
    http.get('/api/me').subscribe();

    const request = controller.expectOne('/api/me');
    expect(request.request.withCredentials).toBe(true);
    request.flush({});
  });

  it('marks only state-changing calls, which is what the relay checks for CSRF', () => {
    http.get('/api/admin/devices').subscribe();
    const read = controller.expectOne('/api/admin/devices');
    expect(read.request.headers.has('X-Requested-With')).toBe(false);
    read.flush({ devices: [] });

    http.post('/api/admin/devices/a/revoke', {}).subscribe();
    const write = controller.expectOne('/api/admin/devices/a/revoke');
    expect(write.request.headers.get('X-Requested-With')).toBe('termexo-console');
    write.flush({});
  });

  it('sends the operator to the sign-in page when the session is gone', async () => {
    const session = TestBed.inject(SessionService);
    const clear = vi.spyOn(session, 'clear');
    const failed = new Promise<number>((resolve) => {
      http
        .get('/api/admin/users')
        .subscribe({ error: (error: { status: number }) => resolve(error.status) });
    });

    controller
      .expectOne('/api/admin/users')
      .flush({ error: '未登录' }, { status: 401, statusText: 'Unauthorized' });

    await expect(failed).resolves.toBe(401);
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(clear).toHaveBeenCalled();
  });

  it('leaves a rejected sign-in to the form that asked for it', async () => {
    const failed = new Promise<number>((resolve) => {
      http
        .post(LOGIN_ENDPOINT, { username: 'ada', password: 'wrong' })
        .subscribe({ error: (error: { status: number }) => resolve(error.status) });
    });

    controller
      .expectOne(LOGIN_ENDPOINT)
      .flush({ error: '用户名或密码不正确' }, { status: 401, statusText: 'Unauthorized' });

    await expect(failed).resolves.toBe(401);
    // Redirecting here would replace the message the operator needs to read.
    expect(navigate).not.toHaveBeenCalled();
  });
});
