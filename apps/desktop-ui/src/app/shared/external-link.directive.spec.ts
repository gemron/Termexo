import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { invoke } from '@tauri-apps/api/core';
import { vi } from 'vitest';

import { ExternalLinkDirective, SUPPORT_EMAIL } from './external-link.directive';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

@Component({
  imports: [ExternalLinkDirective],
  template: `<a appExternalLink [href]="url" (openFailed)="error = $event">Open</a>`,
})
class LinkHost {
  url = 'https://www.termexo.com/guide.html#remote';
  error: string | null = null;
}

describe('ExternalLinkDirective', () => {
  const originalRuntime = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  });

  afterEach(() => {
    if (originalRuntime) Object.defineProperty(window, '__TAURI_INTERNALS__', originalRuntime);
    else Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  async function click(url: string) {
    const fixture = TestBed.createComponent(LinkHost);
    fixture.componentInstance.url = url;
    fixture.detectChanges();
    const event = new MouseEvent('click', { cancelable: true });
    fixture.debugElement
      .query(By.directive(ExternalLinkDirective))
      .triggerEventHandler('click', event);
    await fixture.whenStable();
    return { event, host: fixture.componentInstance };
  }

  it('leaves browser and remote-client links on the browsing device', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    const { event } = await click(`mailto:${SUPPORT_EMAIL}`);
    expect(event.defaultPrevented).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('opens desktop documentation in the system browser', async () => {
    const url = 'https://www.termexo.com/guide.html#remote';
    const { event } = await click(url);
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith('open_terminal_url', { url });
  });

  it('uses a dedicated command without caller-supplied arguments for the support email', async () => {
    await click(`mailto:${SUPPORT_EMAIL}`);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_support_email');
  });

  it('reports launch failures so users can use the displayed email address manually', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('No handler available'));
    const { host } = await click(`mailto:${SUPPORT_EMAIL}`);
    expect(host.error).toBe('No handler available');
  });
});
