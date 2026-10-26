import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentInstallation,
  CliOperationPlan,
  CliOperationResult,
  ManagedAgentType,
} from '../core/models/agent.models';
import { AgentInstallService } from '../core/services/agent-install.service';
import { AgentService } from '../core/services/agent.service';
import { AgentInstallPanelComponent } from './agent-install-panel';

const installed = (type: ManagedAgentType, available = false): AgentInstallation => ({
  agentType: type,
  installed: available,
  healthy: available,
  version: available ? '1.0.0' : undefined,
  diagnostic: available ? 'Available' : 'Not installed',
});
const plan = (values: Partial<CliOperationPlan> = {}): CliOperationPlan => ({
  agentType: 'claude',
  displayName: 'Claude Code',
  packageName: '@anthropic-ai/claude-code',
  targetVersion: 'latest',
  installer: 'npm',
  supportsVersion: true,
  packageSpec: '@anthropic-ai/claude-code@latest',
  action: 'install',
  resolvedVersion: '2.0.0',
  upToDate: false,
  npmPath: 'C:/nodejs/npm.cmd',
  npmVersion: '11.0',
  commandPreview: 'npm install --global @anthropic-ai/claude-code@latest',
  ready: true,
  diagnostic: 'Ready',
  ...values,
});
const result = (values: Partial<CliOperationResult> = {}): CliOperationResult => ({
  success: true,
  plan: plan(),
  installation: installed('claude', true),
  stdout: 'done',
  stderr: '',
  durationMs: 1000,
  diagnostic: 'Installed',
  rollbackAttempted: false,
  ...values,
});

describe('AgentInstallPanelComponent', () => {
  let fixture: ComponentFixture<AgentInstallPanelComponent>;
  let root: HTMLElement;
  let flow: AgentInstallService;
  const states = {
    claude: signal(installed('claude')),
    codex: signal(installed('codex')),
    opencode: signal(installed('opencode')),
    pi: signal(installed('pi')),
    grok: signal(installed('grok')),
    antigravity: signal(installed('antigravity')),
  };
  const agents = {
    installation: states.claude,
    codexInstallation: states.codex,
    openCodeInstallation: states.opencode,
    piInstallation: states.pi,
    grokInstallation: states.grok,
    antigravityInstallation: states.antigravity,
    detectionStates: () =>
      Object.fromEntries(Object.keys(states).map((type) => [type, { status: 'complete' }])),
    previewCliOperation: vi.fn(),
    executeCliOperation: vi.fn(),
    refreshInstallations: vi.fn(),
  };

  beforeEach(async () => {
    window.localStorage.setItem('termexo.language', 'zh-CN');
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    for (const type of Object.keys(states) as ManagedAgentType[]) states[type].set(installed(type));
    agents.previewCliOperation.mockReset().mockResolvedValue(plan());
    agents.executeCliOperation.mockReset().mockResolvedValue(result());
    agents.refreshInstallations.mockReset().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [AgentInstallPanelComponent],
      providers: [{ provide: AgentService, useValue: agents }],
    }).compileComponents();
    flow = TestBed.inject(AgentInstallService);
    fixture = TestBed.createComponent(AgentInstallPanelComponent);
    root = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });
  afterEach(() => Reflect.deleteProperty(window, '__TAURI_INTERNALS__'));

  const settle = async () => {
    await vi.waitFor(() => expect(flow.stage()).toBe('idle'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const primary = () => root.querySelector<HTMLButtonElement>('.primary-actions .primary')!;
  const click = (label: string) => {
    const button = [...root.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(label),
    );
    expect(button, label).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  };

  it('installs with one explicit click and keeps commands and version choices in a closed section', async () => {
    expect(root.querySelector<HTMLDetailsElement>('.advanced')?.open).toBe(false);
    expect(root.querySelector('input')).toBeNull();
    primary().click();
    await settle();
    expect(agents.previewCliOperation).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'claude', installer: undefined }),
    );
    expect(agents.executeCliOperation).toHaveBeenCalledWith(
      expect.objectContaining({ confirmed: true }),
    );
    expect(root.querySelector('.success')?.textContent).toContain('已准备好');
    expect(root.querySelector('.success')?.textContent).toContain('新建');
  });

  it('checks an installed agent before offering an update, then only updates on the second click', async () => {
    states.claude.set(installed('claude', true));
    agents.previewCliOperation.mockResolvedValue(
      plan({ action: 'upgrade', currentVersion: '1.0.0' }),
    );
    fixture.detectChanges();
    expect(primary().textContent).toContain('检查更新');
    primary().click();
    await settle();
    expect(agents.executeCliOperation).not.toHaveBeenCalled();
    expect(primary().textContent).toContain('立即更新');
    primary().click();
    await settle();
    expect(agents.executeCliOperation).toHaveBeenCalledTimes(1);
  });

  it('does not reinstall a current version unless repair is explicitly requested', async () => {
    states.claude.set(installed('claude', true));
    agents.previewCliOperation.mockResolvedValue(plan({ upToDate: true, action: 'reinstall' }));
    fixture.detectChanges();
    primary().click();
    await settle();
    expect(primary().disabled).toBe(true);
    expect(root.querySelector('.success')?.textContent).toContain('已是最新');
    expect(agents.executeCliOperation).not.toHaveBeenCalled();
    click('修复安装');
    await settle();
    expect(agents.executeCliOperation).toHaveBeenCalledTimes(1);
  });

  it('offers a direct setup step for missing Node.js and checks it again after detection', async () => {
    click('OpenCode');
    agents.previewCliOperation.mockResolvedValueOnce(
      plan({ agentType: 'opencode', ready: false, npmPath: undefined, npmVersion: undefined }),
    );
    primary().click();
    await settle();
    expect(root.textContent).toContain('先安装 Node.js');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://nodejs.org/en/download');
    expect(agents.executeCliOperation).not.toHaveBeenCalled();
    agents.previewCliOperation.mockResolvedValue(plan({ agentType: 'opencode' }));
    click('重新检测');
    await vi.waitFor(() => expect(agents.previewCliOperation).toHaveBeenCalledTimes(2));
    await settle();
    expect(root.textContent).not.toContain('先安装 Node.js');
  });

  it('turns a network error into recovery instructions and retries the same installation', async () => {
    agents.executeCliOperation.mockResolvedValueOnce(
      result({ success: false, stderr: 'ECONNRESET', diagnostic: 'Download failed' }),
    );
    primary().click();
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('检查网络或代理');
    click('重试');
    await settle();
    expect(agents.executeCliOperation).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.success')).toBeTruthy();
  });

  it('keeps a running operation visible after closing and reopening the settings panel', async () => {
    let finish!: (value: CliOperationPlan) => void;
    agents.previewCliOperation.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    click('Pi Agent');
    primary().click();
    fixture.detectChanges();
    expect(primary().disabled).toBe(true);
    fixture.destroy();
    fixture = TestBed.createComponent(AgentInstallPanelComponent);
    root = fixture.nativeElement;
    fixture.detectChanges();
    expect(root.querySelector('.selected')?.textContent).toContain('Pi Agent');
    expect(root.textContent).toContain('正在检查电脑环境');
    finish(plan({ agentType: 'pi' }));
    await settle();
    expect(agents.executeCliOperation).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.success')).toBeTruthy();
  });

  it('does not show another agent’s old result and disables repeat clicks while starting', async () => {
    let finish!: (value: CliOperationPlan) => void;
    agents.previewCliOperation.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    primary().click();
    primary().click();
    expect(agents.previewCliOperation).toHaveBeenCalledTimes(1);
    finish(plan());
    await settle();
    click('Codex');
    expect(root.querySelector('.success')).toBeNull();
    expect(primary().textContent).toContain('安装最新版本');
  });

  it('passes an advanced version and installer through without changing them', async () => {
    const component = fixture.componentInstance;
    component['installer'].set('npm');
    component['version'].set('1.5.0');
    fixture.detectChanges();
    primary().click();
    await settle();
    expect(agents.executeCliOperation).toHaveBeenCalledWith(
      expect.objectContaining({ installer: 'npm', targetVersion: '1.5.0' }),
    );
  });

  it('handles a failed version check without getting stuck in a running state', async () => {
    agents.previewCliOperation.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    primary().click();
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('检查网络或代理');
    expect(agents.executeCliOperation).not.toHaveBeenCalled();
    click('重试');
    await settle();
    expect(root.querySelector('.success')).toBeTruthy();
  });

  it('shows a failed registry lookup as a check failure instead of offering an update', async () => {
    states.claude.set(installed('claude', true));
    agents.previewCliOperation.mockResolvedValueOnce(
      plan({ action: 'upgrade', resolvedVersion: undefined }),
    );
    fixture.detectChanges();
    primary().click();
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('未能检查可用版本');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('网络或代理');
    expect(primary().textContent).toContain('检查更新');
    expect(agents.executeCliOperation).not.toHaveBeenCalled();
    click('重试');
    await settle();
    expect(agents.previewCliOperation).toHaveBeenCalledTimes(2);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(primary().textContent).toContain('立即更新');
    expect(agents.executeCliOperation).not.toHaveBeenCalled();
  });

  it('rechecks an unresolved version before retrying a one-click installation', async () => {
    agents.previewCliOperation.mockResolvedValueOnce(plan({ resolvedVersion: undefined }));
    primary().click();
    await settle();
    expect(agents.executeCliOperation).not.toHaveBeenCalled();
    click('重试');
    await settle();
    expect(agents.previewCliOperation).toHaveBeenCalledTimes(2);
    expect(agents.executeCliOperation).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.success')).toBeTruthy();
  });

  it('explains and runs the official Antigravity updater in one click without a registry lookup', async () => {
    states.antigravity.set(installed('antigravity', true));
    agents.previewCliOperation.mockResolvedValue(
      plan({ agentType: 'antigravity', installer: 'script', resolvedVersion: undefined }),
    );
    click('Antigravity');
    expect(root.querySelector('.agent-heading')?.textContent).toContain('官方更新程序');
    expect(primary().textContent).toContain('检查并更新');
    primary().click();
    await settle();
    expect(agents.executeCliOperation).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'antigravity', confirmed: true }),
    );
  });
});
