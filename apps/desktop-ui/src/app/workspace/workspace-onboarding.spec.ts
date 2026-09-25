import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nService } from '../core/i18n/i18n.service';
import { type AgentInstallation, type ManagedAgentType } from '../core/models/agent.models';
import { type AgentType } from '../core/models/workspace.models';
import { AgentService, type AgentDetectionState } from '../core/services/agent.service';
import { WorkspaceOnboardingComponent } from './workspace-onboarding';

const installation = (agentType: ManagedAgentType, healthy: boolean): AgentInstallation => ({
  agentType,
  installed: healthy,
  healthy,
  version: healthy ? '1.2.3' : undefined,
  diagnostic: '',
});

class AgentServiceStub {
  readonly installation = signal<AgentInstallation | null>(null);
  readonly codexInstallation = signal<AgentInstallation | null>(installation('codex', true));
  readonly openCodeInstallation = signal<AgentInstallation | null>(installation('opencode', false));
  readonly grokInstallation = signal<AgentInstallation | null>({
    ...installation('grok', false),
    installed: true,
    diagnostic: 'Version check failed',
  });
  readonly antigravityInstallation = signal<AgentInstallation | null>(null);
  readonly detectionStates = signal<Partial<Record<ManagedAgentType, AgentDetectionState>>>({
    antigravity: { status: 'error', message: 'Probe timed out' },
  });
  readonly detectAgent = vi.fn();
  readonly refreshInstallations = vi.fn();
}

describe('WorkspaceOnboardingComponent', () => {
  let fixture: ComponentFixture<WorkspaceOnboardingComponent>;
  let root: HTMLElement;
  let agents: AgentServiceStub;

  function render(): void {
    fixture = TestBed.createComponent(WorkspaceOnboardingComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    TestBed.configureTestingModule({
      imports: [WorkspaceOnboardingComponent],
      providers: [{ provide: AgentService, useClass: AgentServiceStub }],
    });
    agents = TestBed.inject(AgentService) as unknown as AgentServiceStub;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    document.querySelector('meta[name="termexo-remote"]')?.remove();
  });

  it('puts the ready CLI first and distinguishes checking, missing, broken and failed probes', () => {
    render();
    const rows = Array.from(root.querySelectorAll('.agent-list li'));
    expect(rows[0].getAttribute('data-agent')).toBe('codex');
    const row = (agent: string) => root.querySelector(`[data-agent="${agent}"]`)!;
    expect(row('claude').getAttribute('data-status')).toBe('checking');
    expect(row('claude').querySelector('button')).toBeNull();
    expect(row('opencode').getAttribute('data-status')).toBe('missing');
    expect(row('grok').getAttribute('data-status')).toBe('unhealthy');
    expect(row('antigravity').getAttribute('data-status')).toBe('error');
    expect(row('antigravity').textContent).toContain('Probe timed out');

    agents.installation.set(installation('claude', true));
    fixture.detectChanges();
    expect(row('claude').getAttribute('data-status')).toBe('ready');
    expect(row('claude').querySelector('button')).not.toBeNull();
  });

  it('routes launch, installation, repair and retry to the selected Agent', () => {
    render();
    const launches: AgentType[] = [];
    const installs: ManagedAgentType[] = [];
    fixture.componentInstance.launchRequested.subscribe((type) => launches.push(type));
    fixture.componentInstance.installRequested.subscribe((type) => installs.push(type));

    for (const type of ['codex', 'opencode', 'grok', 'antigravity']) {
      root.querySelector<HTMLButtonElement>(`[data-agent="${type}"] button`)!.click();
    }
    root.querySelector<HTMLButtonElement>('[data-testid="onboarding-shell"]')!.click();
    expect(launches).toEqual(['codex', 'shell']);
    expect(installs).toEqual(['opencode', 'grok']);
    expect(agents.detectAgent).toHaveBeenCalledWith('antigravity');
  });

  it('shows the selected project and advances the next action to launch configuration', () => {
    render();
    let created = 0;
    fixture.componentInstance.createRequested.subscribe(() => created++);
    root.querySelector<HTMLButtonElement>('[data-testid="onboarding-create-workspace"]')!.click();
    expect(created).toBe(1);

    fixture.componentRef.setInput('workspace', { name: 'Demo', projectPath: 'D:/demo' });
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="onboarding-create-workspace"]')).toBeNull();
    expect(root.querySelector('.project-path')?.textContent).toBe('D:/demo');
    const i18n = TestBed.inject(I18nService);
    expect(root.querySelector('[aria-current="step"]')?.textContent).toContain(
      i18n.t('onboarding.agentTitle'),
    );
    expect(root.querySelector('[data-agent="codex"] button')?.textContent).toContain(
      i18n.t('onboarding.startAgent'),
    );
  });

  it('keeps preview capability limits explicit and does not offer native detection or installation', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    render();
    expect(root.querySelector('.preview-note')).not.toBeNull();
    expect(root.querySelector('.agent-list')).toBeNull();
    expect(agents.refreshInstallations).not.toHaveBeenCalled();
  });

  it('allows a remote user to choose a ready host CLI but directs installation to the host', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    const marker = document.createElement('meta');
    marker.name = 'termexo-remote';
    marker.content = JSON.stringify({ version: '0.10.6', secure: true });
    document.head.append(marker);
    render();
    expect(root.querySelector('[data-agent="codex"] button')).not.toBeNull();
    expect(root.querySelector('[data-agent="opencode"] button')).toBeNull();
    expect(root.querySelector('[data-agent="grok"] button')).toBeNull();
    expect(root.textContent).toContain(TestBed.inject(I18nService).t('onboarding.remoteInstall'));
  });
});
