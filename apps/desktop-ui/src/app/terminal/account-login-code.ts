import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { registerTranslations } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { TerminalSession } from '../core/models/workspace.models';
import { readClipboardText } from '../core/services/clipboard-text';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { AccountLoginFeedbackService } from '../core/services/account-login-feedback.service';

registerTranslations({
  en: {
    'account.code': 'Authorization code',
    'account.codeHint': 'If the browser returns a code, paste it here and send it to this login terminal.',
    'account.pasteCode': 'Paste code',
    'account.sendCode': 'Send code',
    'account.codeFailed': 'Could not send the code. The login terminal may have closed.',
    'account.clipboardFailed': 'Could not read the clipboard. Paste the code into the field manually.',
    'account.login.waiting': 'Open the authorization link in the terminal and authorize the account shown above.',
    'account.login.verifying': 'Code sent. Waiting for authentication…',
    'account.login.rejected': 'Authorization failed. The code may be incorrect, expired or already used. Get a new link and try again.',
    'account.login.timeout': 'No authentication result received yet. Check the terminal output or start a new login.',
    'account.login.closed': 'This login ended without confirmed authentication. Start a new login to continue.',
    'account.login.success': 'Authentication confirmed. This account is ready to use.',
    'account.login.restarting': 'Preparing a new login…',
    'account.login.retry': 'Get a new authorization link',
    'account.login.codexHint': 'Complete authorization in the browser. If the terminal shows a device code, enter it on the browser authorization page.',
    'account.login.steps': '1 Open link → 2 Authorize → 3 Confirm result',
  },
  'zh-CN': {
    'account.code': '授权码',
    'account.codeHint': '如果浏览器返回授权码，请粘贴到此处，再发送到当前账号的登录终端。',
    'account.pasteCode': '粘贴授权码',
    'account.sendCode': '发送授权码',
    'account.codeFailed': '授权码发送失败，登录终端可能已关闭。',
    'account.clipboardFailed': '无法读取剪贴板，请手动粘贴到输入框。',
    'account.login.waiting': '请打开终端中的授权链接，并使用上方显示的账号完成授权。',
    'account.login.verifying': '授权码已发送，正在等待认证结果…',
    'account.login.rejected': '授权失败，授权码可能错误、已过期或已使用。请重新获取授权链接后再试。',
    'account.login.timeout': '暂未收到认证结果，请检查终端输出，或重新发起登录。',
    'account.login.closed': '本次登录已结束，尚未确认认证成功。请重新发起登录。',
    'account.login.success': '认证成功，该账号已可使用。',
    'account.login.restarting': '正在准备新的登录…',
    'account.login.retry': '重新获取授权链接',
    'account.login.codexHint': '请在浏览器中完成授权；如果终端显示设备码，请将其填写到浏览器授权页面。',
    'account.login.steps': '1 打开链接 → 2 完成授权 → 3 确认结果',
  },
  de: {
    'account.code': 'Autorisierungscode',
    'account.codeHint': 'Falls der Browser einen Code anzeigt, hier einfügen und an dieses Anmeldeterminal senden.',
    'account.pasteCode': 'Code einfügen',
    'account.sendCode': 'Code senden',
    'account.codeFailed': 'Code konnte nicht gesendet werden. Das Anmeldeterminal ist möglicherweise geschlossen.',
    'account.clipboardFailed': 'Zwischenablage konnte nicht gelesen werden. Fügen Sie den Code manuell ein.',
    'account.login.waiting': 'Öffnen Sie den Link im Terminal und autorisieren Sie das oben angezeigte Konto.',
    'account.login.verifying': 'Code gesendet. Authentifizierung wird geprüft…',
    'account.login.rejected': 'Autorisierung fehlgeschlagen. Der Code ist möglicherweise falsch, abgelaufen oder bereits verwendet. Fordern Sie einen neuen Link an.',
    'account.login.timeout': 'Noch kein Ergebnis erhalten. Prüfen Sie die Terminalausgabe oder starten Sie die Anmeldung erneut.',
    'account.login.closed': 'Anmeldung ohne bestätigte Authentifizierung beendet. Starten Sie eine neue Anmeldung.',
    'account.login.success': 'Authentifizierung bestätigt. Dieses Konto ist einsatzbereit.',
    'account.login.restarting': 'Neue Anmeldung wird vorbereitet…',
    'account.login.retry': 'Neuen Autorisierungslink anfordern',
    'account.login.codexHint': 'Schließen Sie die Autorisierung im Browser ab. Geben Sie einen im Terminal angezeigten Gerätecode auf der Autorisierungsseite ein.',
    'account.login.steps': '1 Link öffnen → 2 Autorisieren → 3 Ergebnis bestätigen',
  },
});

/** A normal browser input avoids terminal focus/echo problems when returning from OAuth. */
@Component({
  selector: 'app-account-login-code',
  imports: [FormsModule, TranslatePipe],
  template: `
    <form (submit)="$event.preventDefault(); send()" (mousedown)="$event.stopPropagation()">
      <div class="login-heading"><strong>{{ feedback()?.profileName || session().name }}</strong>
        <span>{{ session().agentType === 'claude' ? 'Claude' : 'Codex' }}</span>
        <small>{{ 'account.login.steps' | t }}</small>
      </div>
      <p class="login-status" [class.login-error]="phase() === 'rejected' || phase() === 'closed' || phase() === 'timeout'"
        role="status" aria-live="polite" [attr.data-phase]="phase()">{{ ('account.login.' + phase()) | t }}</p>
      @if (session().agentType === 'claude' && phase() !== 'success') {
      <label><span>{{ 'account.code' | t }}</span>
        <input type="password" autocomplete="off" spellcheck="false" [attr.aria-label]="'account.code' | t"
          [ngModel]="code()" (ngModelChange)="code.set($event)" name="authorizationCode" [disabled]="blocked()" />
      </label>
      <button type="button" [disabled]="blocked()" (click)="paste()">{{ 'account.pasteCode' | t }}</button>
      <button type="submit" [disabled]="blocked() || !valid()">{{ 'account.sendCode' | t }}</button>
      <small>{{ 'account.codeHint' | t }}</small>
      } @else if (phase() !== 'success') {
        <small>{{ 'account.login.codexHint' | t }}</small>
      }
      @if (error(); as message) { <small role="alert">{{ message | t }}</small> }
      @if (phase() !== 'success') {
        <button class="retry-login" type="button" [disabled]="busy() || phase() === 'restarting'"
          (click)="retryRequested.emit(session().id)">{{ 'account.login.retry' | t }}</button>
      }
    </form>
  `,
  styles: `
    form { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid var(--border); background: var(--surface-1); font-size: 12px; }
    label { display: grid; gap: 4px; flex: 1 1 180px; }
    input { min-width: 0; width: 100%; font-size: 16px; }
    input, button { border: 1px solid var(--border); border-radius: 5px; padding: 6px 8px;
      color: var(--text); background: var(--surface-0); }
    button:disabled { opacity: .5; }
    small { flex-basis: 100%; color: var(--text-muted); }
    [role=alert] { color: var(--color-error); }
    .login-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; width: 100%; }
    .login-heading span { color: var(--text-muted); }
    .login-heading small { flex-basis: auto; margin-left: auto; }
    .login-status { flex-basis: 100%; margin: 0; padding: 8px 10px; border-left: 3px solid var(--accent);
      background: var(--surface-0); border-radius: 4px; line-height: 1.5; }
    .login-status.login-error { border-color: var(--color-error); }
    .retry-login { margin-left: auto; }
  `,
})
export class AccountLoginCodeComponent {
  private readonly gateway = inject(TerminalGatewayService);
  private readonly loginFeedback = inject(AccountLoginFeedbackService);
  readonly session = input.required<TerminalSession>();
  readonly retryRequested = output<string>();
  protected readonly feedback = computed(() => this.loginFeedback.get(this.session().id));
  protected readonly phase = computed(() => {
    const phase = this.feedback()?.phase;
    if ((!phase || phase === 'waiting') && ['FAILED', 'STOPPED', 'DISCONNECTED', 'COMPLETED'].includes(this.session().status)) return 'closed';
    return phase ?? 'waiting';
  });
  protected readonly blocked = computed(() => this.busy() || ['verifying', 'rejected', 'closed', 'success', 'restarting'].includes(this.phase())
    || ['FAILED', 'STOPPED', 'DISCONNECTED', 'COMPLETED'].includes(this.session().status));
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly valid = computed(() => {
    const code = this.code().trim();
    return !!code && code.length <= 4096 && !/[\r\n\x00-\x1f\x7f]/.test(code);
  });

  protected async paste(): Promise<void> {
    if (this.blocked()) return;
    try {
      this.code.set(await readClipboardText());
      this.error.set('');
    } catch {
      this.error.set('account.clipboardFailed');
    }
  }

  protected async send(): Promise<void> {
    if (!this.valid() || this.blocked() || !this.session().accountLogin || this.session().agentType !== 'claude') return;
    this.busy.set(true);
    this.error.set('');
    if (!this.feedback()) {
      const session = this.session();
      this.loginFeedback.begin(session.id, { id: session.accountProfileId ?? '', name: session.name,
        agentType: 'claude', isDefault: false, isSystem: false, authenticated: true, diagnostic: '' });
    }
    this.loginFeedback.verifying(this.session().id);
    try {
      // Write directly to this PTY: no prompt capture, history, telemetry or workspace persistence.
      await this.gateway.write(this.session(), this.code().trim() + '\r');
      this.code.set('');
    } catch {
      this.error.set('account.codeFailed');
      if (this.phase() === 'verifying') this.loginFeedback.setPhase(this.session().id, 'waiting');
    } finally {
      this.busy.set(false);
    }
  }
}
