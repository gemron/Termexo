import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WechatNotificationsPanelComponent } from './wechat-notifications-panel';
import { AppStateService } from '../core/services/app-state.service';
import { WechatNotificationsService } from '../core/services/wechat-notifications.service';
import { DEFAULT_WECHAT_SETTINGS } from '../core/models/wechat-notifications';

describe('WeChat configuration interactions', () => {
  const flow = {
    settings: signal({ ...DEFAULT_WECHAT_SETTINGS }),
    history: signal([]),
    error: signal(''),
    refresh: vi.fn().mockResolvedValue(undefined),
    save: vi.fn(),
    probe: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppStateService, useValue: { workspaces: signal([{ id: 'w', name: '项目' }]) } },
        { provide: WechatNotificationsService, useValue: flow },
      ],
    });
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });
  async function create() {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    const fixture = TestBed.createComponent(WechatNotificationsPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    return fixture;
  }
  it('refreshes history without discarding an unsaved target or saving configuration', async () => {
    const fixture = await create();
    const target = fixture.nativeElement.querySelector('.input') as HTMLInputElement;
    target.value = '尚未保存的目标';
    target.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent?.includes('刷新记录'))!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(target.value).toBe('尚未保存的目标');
    expect(flow.save).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('未保存的配置保持不变');
  });
  it('shows progress and protects fields until the no-send check finishes', async () => {
    let finish!: (value: { status: string; detail: string }) => void;
    const fixture = await create();
    flow.probe.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.find((b) => b.textContent?.includes('检查目标'))!.disabled).toBe(false);
    buttons.find((b) => b.textContent?.includes('检查目标'))!.click();
    expect(flow.probe).toHaveBeenCalledWith(DEFAULT_WECHAT_SETTINGS.target);
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在切换微信并检查目标');
    expect((fixture.nativeElement.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(
      true,
    );
    finish({ status: 'ready', detail: '目标可用，未发送。' });
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('目标检查通过');
    expect(fixture.nativeElement.textContent).toContain('未输入或发送消息');
    expect((fixture.nativeElement.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(
      false,
    );
    expect(flow.save).not.toHaveBeenCalled();
  });
  it('shows an unsuccessful target check as an alert without saving or sending', async () => {
    const fixture = await create();
    flow.probe.mockResolvedValue({ status: 'failed', detail: '未找到目标，未发送。' });
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent?.includes('检查目标'))!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    const alert = fixture.nativeElement.querySelector('.feedback[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('未找到目标');
    expect(flow.save).not.toHaveBeenCalled();
  });
});
