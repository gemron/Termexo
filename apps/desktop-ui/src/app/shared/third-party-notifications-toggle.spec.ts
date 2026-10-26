import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThirdPartyNotificationsService } from '../core/services/third-party-notifications.service';
import { ThirdPartyNotificationsToggleComponent } from './third-party-notifications-toggle';

const backend = vi.hoisted(() => ({ invoke: vi.fn() }));

describe('topbar third party notification switch', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke: backend.invoke }, configurable: true });
    backend.invoke.mockReset().mockImplementation(async (command, args) => ({
      enabled: command === 'read_third_party_notifications' ? true : args.enabled,
    }));
    TestBed.configureTestingModule({});
  });
  afterEach(() => { Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); });
  async function settle(fixture: ComponentFixture<ThirdPartyNotificationsToggleComponent>) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }
  async function create() {
    const fixture = TestBed.createComponent(ThirdPartyNotificationsToggleComponent);
    fixture.detectChanges();
    await settle(fixture);
    return fixture;
  }

  it('reflects the saved master state and immediately saves a click', async () => {
    const fixture = await create();
    const button = fixture.nativeElement.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(button.textContent).toContain('第三方通知');
    expect(button.getAttribute('aria-checked')).toBe('true');
    button.click();
    await settle(fixture);
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(button.title).toContain('各渠道原有配置');
    expect(backend.invoke).toHaveBeenCalledWith('set_third_party_notifications_enabled', { enabled: false }, undefined);
  });

  it('keeps the real state on failure, reports it, and permits retry', async () => {
    const fixture = await create();
    const failed = vi.fn();
    fixture.componentInstance.failed.subscribe(failed);
    const button = fixture.nativeElement.querySelector('[role="switch"]') as HTMLButtonElement;
    backend.invoke.mockRejectedValueOnce(new Error('offline'));
    button.click();
    await settle(fixture);
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(button.title).toContain('点击重试');
    expect(failed).toHaveBeenCalledWith(expect.stringContaining('offline'));
    button.click();
    await settle(fixture);
    expect(TestBed.inject(ThirdPartyNotificationsService).enabled()).toBe(false);
  });
});
