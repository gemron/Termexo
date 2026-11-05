import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { OneRingPluginService } from '../core/services/one-ring-plugin.service';
import { CodexPluginsPanelComponent } from './codex-plugins-panel';

describe('Codex plugin settings', () => {
  it('shows desktop guidance in browser preview without invoking the backend', () => {
    const get = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: OneRingPluginService, useValue: { desktop: false, get } }],
    });
    const fixture = TestBed.createComponent(CodexPluginsPanelComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('fieldset')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
  it('allows disabling without requiring installed plugin paths', async () => {
    const status = {
      settings: { enabled: false, sourcePath: '', nodePath: '' },
      supported: true,
      ready: false,
      diagnostic: 'Missing source',
    };
    const save = vi.fn().mockResolvedValue(status);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: OneRingPluginService,
          useValue: { desktop: true, get: vi.fn().mockResolvedValue(status), save },
        },
      ],
    });
    const fixture = TestBed.createComponent(CodexPluginsPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.btn-primary').click();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledWith(status.settings);
  });
});
