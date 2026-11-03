import { Component, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { registerTranslations } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';

registerTranslations({
  en: { 'terminal.mobileMessage': 'Command or message', 'terminal.mobileSend': 'Send', 'terminal.mobileHint': 'Enter to send · Shift+Enter for a new line', 'terminal.mobileSendFailed': 'Could not send. Check the connection and try again.' },
  'zh-CN': { 'terminal.mobileMessage': '输入命令或消息', 'terminal.mobileSend': '发送', 'terminal.mobileHint': 'Enter 发送 · Shift+Enter 换行', 'terminal.mobileSendFailed': '发送失败，请检查连接后重试。' },
  de: { 'terminal.mobileMessage': 'Befehl oder Nachricht', 'terminal.mobileSend': 'Senden', 'terminal.mobileHint': 'Enter zum Senden · Shift+Enter für eine neue Zeile', 'terminal.mobileSendFailed': 'Senden fehlgeschlagen. Verbindung prüfen und erneut versuchen.' },
});

/** This field belongs to the page, never to xterm's moving cursor or output renderer. */
@Component({
  selector: 'app-terminal-mobile-input',
  imports: [FormsModule, TranslatePipe],
  template: `
    <form (submit)="$event.preventDefault(); send()" (mousedown)="$event.stopPropagation()">
      <textarea name="terminalMessage" rows="2" maxlength="32000" spellcheck="false"
        autocomplete="off" autocapitalize="off" enterkeyhint="send"
        [attr.aria-label]="'terminal.mobileMessage' | t" [placeholder]="'terminal.mobileMessage' | t"
        [ngModel]="text()" (ngModelChange)="text.set($event)" [disabled]="disabled()"
        (keydown)="onKeydown($event)"></textarea>
      <button type="submit" [disabled]="disabled() || sending() || !text()">{{ 'terminal.mobileSend' | t }}</button>
      <small>{{ (failed() ? 'terminal.mobileSendFailed' : 'terminal.mobileHint') | t }}</small>
    </form>
  `,
  styles: `
    :host { display: block; min-width: 0; border-top: 1px solid var(--border); background: var(--surface-1); }
    form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 8px; padding: 8px 10px; }
    textarea { min-width: 0; width: 100%; min-height: 46px; max-height: 110px; resize: none;
      font: 16px/1.4 var(--mono); color: var(--text); background: var(--surface-0);
      padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; }
    button { align-self: stretch; padding: 0 12px; border-radius: 6px; color: var(--text); background: var(--surface-2); }
    button:disabled { opacity: .45; }
    small { grid-column: 1 / -1; color: var(--text-muted); font-size: 10px; }
  `,
})
export class TerminalMobileInputComponent {
  readonly disabled = input(false);
  readonly sendText = input.required<(text: string) => Promise<void>>();
  protected readonly text = signal('');
  protected readonly sending = signal(false);
  protected readonly failed = signal(false);

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void this.send();
  }

  protected async send(): Promise<void> {
    const text = this.text();
    if (!text || this.disabled() || this.sending()) return;
    this.sending.set(true);
    this.failed.set(false);
    try {
      await this.sendText()(text);
      if (this.text() === text) this.text.set('');
    } catch {
      this.failed.set(true);
    } finally {
      this.sending.set(false);
    }
  }
}
