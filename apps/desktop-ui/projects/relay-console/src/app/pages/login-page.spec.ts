import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import type { UserView } from '../core/console.models';
import { SessionService } from '../core/session.service';
import { LoginPageComponent } from './login-page';

const ADMIN: UserView = {
  id: 'u1',
  username: 'admin',
  role: 'admin',
  disabled: false,
  createdAt: 1,
  lastLoginAt: null,
  deviceCount: 0,
};

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let root: HTMLElement;
  let signIn: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  const field = (name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const submit = () => root.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  function type(name: string, value: string): void {
    const input = field(name);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    signIn = vi.fn().mockResolvedValue(ADMIN);
    navigate = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        { provide: SessionService, useValue: { signIn } },
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPageComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('refuses to submit until both fields are filled in', () => {
    expect(submit().disabled).toBe(true);

    type('username', 'admin');
    expect(submit().disabled).toBe(true);

    type('password', 'hunter2hunter2');
    expect(submit().disabled).toBe(false);
  });

  it('signs in and opens the console', async () => {
    type('username', '  admin  ');
    type('password', 'hunter2hunter2');

    submit().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(signIn).toHaveBeenCalledWith('admin', 'hunter2hunter2');
    expect(navigate).toHaveBeenCalledWith(['/']);
    // The password has done its job and must not stay in the field behind the next page.
    expect(field('password').value).toBe('');
  });

  it('shows the relay’s own reason when the sign-in is rejected', async () => {
    signIn.mockRejectedValue(new Error('用户名或密码不正确'));
    type('username', 'admin');
    type('password', 'wrong-password');

    submit().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('.alert.error')?.textContent).toContain('用户名或密码不正确');
    expect(navigate).not.toHaveBeenCalled();
  });
});
