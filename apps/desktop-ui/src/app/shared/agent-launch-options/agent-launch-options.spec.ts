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
  readonly installation = signal<AgentInstallation | null>(null);
  readonly codexInstallation = signal<AgentInstallation | null>(CODEX_INSTALLATION);
  readonly openCodeInstallation = signal<AgentInstallation | null>(null);
  readonly antigravityInstallation = signal<AgentInstallation | null>(null);
}

describe('AgentLaunchOptionsComponent', () => {
  let fixture: ComponentFixture<AgentLaunchOptionsComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentLaunchOptionsComponent],
      providers: [{ provide: AgentService, useClass: AgentServiceStub }],
    });
    fixture = TestBed.createComponent(AgentLaunchOptionsComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  function optionTypes(): (string | null)[] {
    return Array.from(root.querySelectorAll('button')).map((button) =>
      button.getAttribute('data-agent'),
    );
  }

  it('offers every Agent alongside a plain shell', () => {
    expect(optionTypes()).toEqual(['claude', 'codex', 'opencode', 'antigravity', 'shell']);
  });

  it('shows each Agent version, and why an Agent is unavailable', () => {
    const i18n = TestBed.inject(I18nService);
    const hint = (type: AgentType) =>
      root.querySelector(`button[data-agent="${type}"] small`)?.textContent;

    expect(hint('codex')).toBe('0.145.0');
    expect(hint('claude')).toBe(i18n.t('common.notDetected'));
  });

  it('emits the picked option', () => {
    const picked: AgentType[] = [];
    fixture.componentInstance.optionSelected.subscribe((type) => picked.push(type));

    root.querySelector<HTMLButtonElement>('button[data-agent="claude"]')?.click();
    root.querySelector<HTMLButtonElement>('button[data-agent="shell"]')?.click();

    expect(picked).toEqual(['claude', 'shell']);
  });
});
