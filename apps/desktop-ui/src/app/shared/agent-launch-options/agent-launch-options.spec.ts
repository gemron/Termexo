import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { I18nService } from '../../core/i18n/i18n.service';
import { type AgentInstallation } from '../../core/models/agent.models';
import { AgentType } from '../../core/models/workspace.models';
import { AgentService } from '../../core/services/agent.service';
import { AgentLaunchOptionsComponent } from './agent-launch-options';

const CODEX_INSTALLATION: AgentInstallation = {
  agentType: 'codex',
  installed: true,
  executablePath: 'codex',
  version: '0.145.0',
  healthy: true,
  diagnostic: 'Codex CLI 已连接',
};

/** Only the installations the list reads; the real service reaches for the backend. */
class AgentServiceStub {
  readonly piInstallation = signal<AgentInstallation | null>(null);
  readonly detectionStates = signal({});
  readonly installation = signal<AgentInstallation | null>(null);
  readonly codexInstallation = signal<AgentInstallation | null>(CODEX_INSTALLATION);
  readonly openCodeInstallation = signal<AgentInstallation | null>(null);
  readonly grokInstallation = signal<AgentInstallation | null>(null);
  readonly antigravityInstallation = signal<AgentInstallation | null>(null);
}

describe('AgentLaunchOptionsComponent', () => {
  let fixture: ComponentFixture<AgentLaunchOptionsComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    TestBed.configureTestingModule({
      imports: [AgentLaunchOptionsComponent],
      providers: [{ provide: AgentService, useClass: AgentServiceStub }],
    });
    fixture = TestBed.createComponent(AgentLaunchOptionsComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  function optionTypes(): (string | null)[] {
    return Array.from(root.querySelectorAll('button')).map((button) =>
      button.getAttribute('data-agent'),
    );
  }

  it('offers every Agent alongside a plain shell', () => {
    expect(optionTypes()).toEqual([
      'codex',
      'claude',
      'opencode',
      'pi',
      'grok',
      'antigravity',
      'shell',
    ]);
  });

  it('shows each Agent version, and why an Agent is unavailable', () => {
    const i18n = TestBed.inject(I18nService);
    const hint = (type: AgentType) =>
      root.querySelector(`button[data-agent="${type}"] small`)?.textContent;

    expect(hint('codex')).toBe(i18n.t('launcher.ready') + ' · 0.145.0');
    expect(hint('claude')).toBe(i18n.t('launcher.checking'));
  });

  it('labels preview choices without reporting an installation result for a real computer', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    const preview = TestBed.createComponent(AgentLaunchOptionsComponent);
    preview.detectChanges();
    const element: HTMLElement = preview.nativeElement;
    expect(element.querySelector('.menu-group')?.textContent).toBe(
      TestBed.inject(I18nService).t('launcher.previewGroup'),
    );
    expect(element.querySelector('[data-agent="codex"] small')).toBeNull();
  });

  it('emits the picked option', () => {
    const picked: AgentType[] = [];
    fixture.componentInstance.optionSelected.subscribe((type) => picked.push(type));

    root.querySelector<HTMLButtonElement>('button[data-agent="claude"]')?.click();
    root.querySelector<HTMLButtonElement>('button[data-agent="grok"]')?.click();
    root.querySelector<HTMLButtonElement>('button[data-agent="shell"]')?.click();

    expect(picked).toEqual(['claude', 'grok', 'shell']);
  });

  it('uses the same menu item structure for content preview as Shell', () => {
    fixture.componentRef.setInput('includePreview', true);
    fixture.detectChanges();
    const shell = root.querySelector('button[data-agent="shell"]')!;
    const preview = root.querySelector<HTMLButtonElement>('button[data-action="preview"]')!;
    expect(preview.getAttribute('role')).toBe('menuitem');
    expect(preview.querySelector('span[data-tone="slate"] app-icon')).not.toBeNull();
    expect(preview.querySelector('strong')?.textContent).toBe(
      TestBed.inject(I18nService).t('terminal.openPreview'),
    );
    expect(preview.querySelector('small')?.textContent).toBe(
      TestBed.inject(I18nService).t('terminal.previewHint'),
    );
    expect(preview.parentElement).toBe(shell.parentElement);
    const selected = vi.fn();
    fixture.componentInstance.previewRequested.subscribe(selected);
    preview.click();
    expect(selected).toHaveBeenCalledOnce();
  });
});
