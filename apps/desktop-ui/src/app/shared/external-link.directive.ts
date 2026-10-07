import { Directive, ElementRef, HostListener, inject, output } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from '../core/services/tauri-runtime';

export const SUPPORT_EMAIL = 'gemron@foxmail.com';

/** Browser clients use their own device; the desktop delegates to its default URL handler. */
@Directive({ selector: 'a[appExternalLink]' })
export class ExternalLinkDirective {
  readonly openFailed = output<string | null>();
  private readonly element = inject<ElementRef<HTMLAnchorElement>>(ElementRef);

  @HostListener('click', ['$event'])
  protected async open(event: MouseEvent): Promise<void> {
    if (!isTauriRuntime()) return;
    event.preventDefault();
    this.openFailed.emit(null);
    const url = this.element.nativeElement.href;
    try {
      // Only this fixed support address can launch a mail client. Terminal URLs stay HTTP(S)-only.
      if (url === `mailto:${SUPPORT_EMAIL}`) {
        await invoke('open_support_email');
      } else {
        await invoke('open_terminal_url', { url });
      }
    } catch (error) {
      this.openFailed.emit(error instanceof Error ? error.message : String(error));
    }
  }
}
