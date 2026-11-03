import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { I18nService } from '../core/i18n/i18n.service';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { TerminalSession } from '../core/models/workspace.models';
import { AccountLoginCodeComponent } from './account-login-code';
import { AccountLoginFeedbackService } from '../core/services/account-login-feedback.service';

describe('account login code entry', () => {
  const write = vi.fn();
  const session: TerminalSession = { id: 'second-account-login', name: 'Second account', accountLogin: true,
    accountProfileId: 'second', agentType: 'claude', shell: 'powershell.exe', workingDirectory: 'C:/project',
    status: 'RUNNING', model: '', branch: '' };

  beforeEach(() => {
    write.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: TerminalGatewayService, useValue: { write } }] });
    TestBed.inject(I18nService).setPreference('en');
  });

  function create() {
    const fixture = TestBed.createComponent(AccountLoginCodeComponent);
    fixture.componentRef.setInput('session', session);
    fixture.detectChanges();
    return fixture;
  }

  it('sends a pasted code and Enter only to the selected account login, then clears the field', async () => {
    const fixture = create();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = ' oauth-code#state ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(write).toHaveBeenCalledExactlyOnceWith(session, 'oauth-code#state\r');
    expect(input.value).toBe('');
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Waiting for authentication');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(write).toHaveBeenCalledOnce();
  });

  it('rejects multiline input and keeps a code available to retry after a failed write', async () => {
    const fixture = create();
    const view = fixture.componentInstance as unknown as {
      code: { set(value: string): void; (): string }; send(): Promise<void>;
    };
    view.code.set('code\r\nextra-command');
    await view.send();
    expect(write).not.toHaveBeenCalled();
    view.code.set('retry-code');
    write.mockRejectedValueOnce(new Error('closed'));
    await view.send();
    expect(view.code()).toBe('retry-code');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not send');
  });

  it('uses the native clipboard button to fill the field without sending the code automatically', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {
      invoke: async (command: string) => {
        expect(command).toBe('plugin:clipboard-manager|read_text');
        return 'clipboard-code#state';
      },
    } });
    try {
      const fixture = create();
      await fixture.whenStable();
      fixture.nativeElement.querySelector('button[type="button"]').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('input').value).toBe('clipboard-code#state');
      expect(write).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    }
  });

  it('shows invalid-code feedback and emits a retry for the exact account after its process exits', async () => {
    const fixture = create();
    const view = fixture.componentInstance as unknown as { code: { set(value: string): void }; send(): Promise<void> };
    view.code.set('wrong-code');
    await view.send();
    TestBed.inject(AccountLoginFeedbackService).observeOutput(session.id, 'OAuth error: invalid_grant');
    fixture.componentRef.setInput('session', { ...session, status: 'FAILED' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Authorization failed');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    const retry = vi.fn();
    fixture.componentInstance.retryRequested.subscribe(retry);
    fixture.nativeElement.querySelector('.retry-login').click();
    expect(retry).toHaveBeenCalledExactlyOnceWith(session.id);
  });

  it('explains browser authorization instead of offering terminal code input for Codex', () => {
    const fixture = create();
    fixture.componentRef.setInput('session', { ...session, agentType: 'codex' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Complete authorization in the browser');
  });
});
