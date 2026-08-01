import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ModelProfile,
  ModelProfileInput,
  NetworkProfile,
  NetworkProfileInput,
} from '../core/models/agent.models';
import { AgentSettingsDialogComponent } from './agent-settings-dialog';

const CUSTOM_PROFILE: ModelProfile = {
  id: 'custom-default',
  name: 'Team Claude',
  provider: 'Anthropic',
  model: 'claude-sonnet-4-6',
  baseUrl: 'https://api.example.test',
  isDefault: true,
  hasCredential: true,
};

const NETWORK_PROFILE: NetworkProfile = {
  id: 'network-workspace',
  name: '内网代理',
  scope: 'workspace',
  workspaceId: 'workspace-1',
  enabled: true,
  isDefault: true,
  httpsProxy: 'http://proxy.internal:8080',
  noProxy: 'localhost,.internal.example',
  npmRegistry: 'https://npm.internal.example/',
  npmStrictSsl: false,
  proxyUsername: 'builder',
  hasCredential: true,
};

describe('AgentSettingsDialogComponent', () => {
  let fixture: ComponentFixture<AgentSettingsDialogComponent>;
  let component: AgentSettingsDialogComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentSettingsDialogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentSettingsDialogComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
  });

  it('loads the persisted default profile into the editor', async () => {
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('模型 Profile');
    await fixture.whenStable();
    fixture.detectChanges();
    const inputs = root.querySelectorAll<HTMLInputElement>(
      '.profile-editor input:not([type="checkbox"])',
    );

    expect(inputs[0].value).toBe('Team Claude');
    expect(inputs[1].value).toBe('claude-sonnet-4-6');
    expect(inputs[2].value).toBe('https://api.example.test');
    expect(inputs[3].placeholder).toContain('已安全保存');
  });

  it('reuses the generated id when a new profile is saved more than once', async () => {
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('模型 Profile');
    clickButton('新建 Profile');
    setEditorInputValue(0, 'New Profile');
    setEditorInputValue(1, 'sonnet');

    const savedIds: string[] = [];
    component.modelSaved.subscribe((profile) => savedIds.push(profile.id));
    clickButton('保存 Profile');
    clickButton('保存 Profile');

    expect(savedIds).toHaveLength(2);
    expect(savedIds[0]).toBeTruthy();
    expect(savedIds[1]).toBe(savedIds[0]);
  });

  it('fills Claude-compatible settings from a provider preset', async () => {
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('模型 Profile');
    clickButton('新建 Profile');
    const provider = root.querySelector<HTMLSelectElement>('.profile-editor select');
    expect(provider).toBeTruthy();
    provider!.value = 'DeepSeek';
    provider!.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    const inputs = root.querySelectorAll<HTMLInputElement>(
      '.profile-editor input:not([type="checkbox"])',
    );
    expect(inputs[0].value).toBe('DeepSeek V4 Pro');
    expect(inputs[1].value).toBe('deepseek-v4-pro[1m]');
    expect(inputs[2].value).toBe('https://api.deepseek.com/anthropic');
    setEditorInputValue(3, 'test-deepseek-key');

    const saved: ModelProfileInput[] = [];
    component.modelSaved.subscribe((profile) => saved.push(profile));
    clickButton('保存 Profile');
    expect(saved[0]).toEqual(expect.objectContaining({ provider: 'DeepSeek' }));
  });

  it('opens a requested third-party profile and requires its missing API key', async () => {
    const minimax: ModelProfile = {
      id: 'minimax-m3',
      name: 'MiniMax M3',
      provider: 'MiniMax',
      model: 'MiniMax-M3',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      isDefault: false,
      hasCredential: false,
    };
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE, minimax]);
    fixture.componentRef.setInput('initialTab', 'models');
    fixture.componentRef.setInput('initialModelProfileId', minimax.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('.credential-warning')?.textContent).toContain('尚无可用 API Key');
    const saveButton = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.includes('保存 Profile'),
    );
    expect(saveButton?.disabled).toBe(true);

    setEditorInputValue(3, 'test-minimax-key');
    expect(saveButton?.disabled).toBe(false);
    const saved: ModelProfileInput[] = [];
    component.modelSaved.subscribe((profile) => saved.push(profile));
    clickButton('保存 Profile');

    expect(saved).toEqual([
      expect.objectContaining({ id: minimax.id, apiKey: 'test-minimax-key' }),
    ]);
  });

  it('edits and saves a workspace network and npm proxy profile', async () => {
    fixture.componentRef.setInput('activeWorkspaceId', 'workspace-1');
    fixture.componentRef.setInput('activeWorkspaceName', 'Termexo');
    fixture.componentRef.setInput('networkProfiles', [NETWORK_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('网络与 npm');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(labeledInput('HTTPS_PROXY').value).toBe('http://proxy.internal:8080');
    expect(labeledInput('registry').value).toBe('https://npm.internal.example/');
    expect(labeledInput('密码').placeholder).toContain('已安全保存');

    setLabeledInputValue('NO_PROXY', 'localhost,.corp.example');
    const saved: NetworkProfileInput[] = [];
    component.networkSaved.subscribe((profile) => saved.push(profile));
    clickButton('保存代理 Profile');

    expect(saved[0]).toEqual(
      expect.objectContaining({
        id: 'network-workspace',
        scope: 'workspace',
        workspaceId: 'workspace-1',
        httpsProxy: 'http://proxy.internal:8080',
        noProxy: 'localhost,.corp.example',
        npmStrictSsl: false,
      }),
    );
  });

  it('requests a connectivity test for a saved network profile', async () => {
    fixture.componentRef.setInput('networkProfiles', [NETWORK_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('网络与 npm');
    const testedIds: string[] = [];
    component.networkTestRequested.subscribe((profileId) => testedIds.push(profileId));
    clickButton('测试连接');

    expect(testedIds).toEqual(['network-workspace']);
  });

  it('previews an official CLI package with the current workspace scope', async () => {
    fixture.componentRef.setInput('activeWorkspaceId', 'workspace-1');
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('CLI 安装与升级');
    setLabeledInputValue('目标版本', '0.145.0');
    const requests: Array<{ agentType: string; targetVersion?: string; workspaceId?: string }> = [];
    component.cliPreviewRequested.subscribe((request) => requests.push(request));
    clickButton('生成安装计划');

    expect(requests).toEqual([
      {
        agentType: 'claude',
        targetVersion: '0.145.0',
        workspaceId: 'workspace-1',
      },
    ]);
  });

  it('requires confirmation before emitting a CLI mutation', async () => {
    fixture.componentRef.setInput('activeWorkspaceId', 'workspace-1');
    fixture.componentRef.setInput('cliPlan', {
      agentType: 'claude',
      displayName: 'Claude Code',
      packageName: '@anthropic-ai/claude-code',
      targetVersion: 'latest',
      packageSpec: '@anthropic-ai/claude-code@latest',
      action: 'upgrade',
      currentVersion: '2.1.220',
      npmPath: 'C:\\Program Files\\nodejs\\npm.cmd',
      npmVersion: '11.6.2',
      commandPreview: 'npm install --global @anthropic-ai/claude-code@latest --no-fund --no-audit',
      networkProfileId: 'network-workspace',
      networkProfileName: '内网代理',
      npmRegistry: 'https://npm.internal.example/',
      ready: true,
      diagnostic: '可升级 Claude Code。',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('CLI 安装与升级');
    const requests: Array<{ confirmed?: boolean }> = [];
    component.cliExecuteRequested.subscribe((request) => requests.push(request));
    clickButton('确认并升级');
    expect(requests).toEqual([]);

    const confirmation = root.querySelector<HTMLInputElement>('.cli-confirmation input');
    expect(confirmation).toBeTruthy();
    confirmation!.click();
    fixture.detectChanges();
    clickButton('确认并升级');

    expect(requests).toEqual([expect.objectContaining({ confirmed: true })]);
  });

  function clickButton(label: string): void {
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim().includes(label),
    );
    expect(button).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  }

  function setEditorInputValue(index: number, value: string): void {
    const input = root.querySelectorAll<HTMLInputElement>(
      '.profile-editor input:not([type="checkbox"])',
    )[index];
    expect(input).toBeTruthy();
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function labeledInput(label: string): HTMLInputElement {
    const field = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).find((candidate) =>
      candidate.querySelector('span')?.textContent?.trim().includes(label),
    );
    const input = field?.querySelector<HTMLInputElement>('input');
    expect(input).toBeTruthy();
    return input!;
  }

  function setLabeledInputValue(label: string, value: string): void {
    const input = labeledInput(label);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
