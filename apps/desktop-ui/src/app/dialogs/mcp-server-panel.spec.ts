import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nService } from '../core/i18n/i18n.service';
import { registerMcpServerTranslations } from '../core/i18n/mcp-server.i18n';
import type { McpServerStatus } from '../core/models/mcp-server.models';
import { McpServerService } from '../core/services/mcp-server.service';
import { McpServerPanelComponent } from './mcp-server-panel';

registerMcpServerTranslations();

describe('McpServerPanelComponent', () => {
  let fixture: ComponentFixture<McpServerPanelComponent>;
  let root: HTMLElement;
  let status: McpServerStatus;
  const service = { getStatus: vi.fn(), updateSettings: vi.fn(), regenerateToken: vi.fn() };
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    status = {
      settings: {
        enabled: false,
        autoConnectAgents: true,
        port: 7421,
        terminalAccess: true,
        taskAccess: true,
        settingsAccess: false,
      },
      running: false,
      error: null,
      url: 'http://127.0.0.1:7421/mcp',
      token: 'test-mcp-token',
    };
    service.getStatus.mockResolvedValue(status);
    service.updateSettings.mockImplementation(async (settings) => ({
      ...status,
      settings,
      running: settings.enabled,
    }));
    service.regenerateToken.mockResolvedValue({ ...status, token: 'new-token' });
    TestBed.configureTestingModule({
      providers: [{ provide: McpServerService, useValue: service }],
    });
    TestBed.inject(I18nService).setPreference('en');
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
  });

  async function mount() {
    fixture = TestBed.createComponent(McpServerPanelComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    root = fixture.nativeElement;
  }

  const button = (label: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === label,
    )!;

  it('shows the local endpoint and masks the token', async () => {
    await mount();
    expect(root.textContent).toContain('http://127.0.0.1:7421/mcp');
    expect(root.textContent).not.toContain('test-mcp-token');
    button('Show token').click();
    fixture.detectChanges();
    expect(root.querySelector('.token')?.textContent).toBe('test-mcp-token');
  });

  it('applies the service switch and independent access groups', async () => {
    await mount();
    const boxes = root.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    boxes[0].click();
    boxes[4].click();
    await fixture.whenStable();
    button('Apply').click();
    await fixture.whenStable();
    expect(service.updateSettings).toHaveBeenCalledWith({
      enabled: true,
      autoConnectAgents: true,
      port: 7421,
      terminalAccess: true,
      taskAccess: true,
      settingsAccess: true,
    });
    expect(root.textContent).toContain('Running');
  });

  it('rejects invalid ports without sending settings to the backend', async () => {
    await mount();
    const input = root.querySelector<HTMLInputElement>('input[type=number]')!;
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button('Apply').click();
    await fixture.whenStable();
    expect(service.updateSettings).not.toHaveBeenCalled();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('between 1 and 65535');
  });

  it('allows automatic agent connection to be disabled independently of the server', async () => {
    status.settings.enabled = true;
    await mount();
    const boxes = root.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(boxes[1].checked).toBe(true);
    boxes[1].click();
    await fixture.whenStable();
    button('Apply').click();
    await fixture.whenStable();
    expect(service.updateSettings).toHaveBeenCalledWith({
      ...status.settings,
      autoConnectAgents: false,
    });
    expect(root.textContent).toContain('Running');
  });

  it('copies an authenticated JSON connection without showing its secret on screen', async () => {
    await mount();
    button('Copy JSON configuration').click();
    await fixture.whenStable();
    const config = JSON.parse(clipboard.writeText.mock.calls[0][0]);
    expect(config.mcpServers.termexo).toEqual({
      type: 'http',
      url: status.url,
      headers: { Authorization: 'Bearer test-mcp-token' },
    });
    expect(root.textContent).not.toContain('test-mcp-token');
  });

  it('hides the regenerated token and displays backend start failures', async () => {
    await mount();
    button('Show token').click();
    fixture.detectChanges();
    button('Regenerate token').click();
    await fixture.whenStable();
    expect(root.textContent).not.toContain('new-token');
    service.updateSettings.mockResolvedValueOnce({ ...status, error: 'Port in use' });
    button('Apply').click();
    await fixture.whenStable();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Port in use');
  });

  it('does not expose administration outside the desktop', async () => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    await mount();
    expect(service.getStatus).not.toHaveBeenCalled();
    expect(root.textContent).toContain('desktop app');
    expect(root.querySelectorAll('input')).toHaveLength(0);
  });
});
