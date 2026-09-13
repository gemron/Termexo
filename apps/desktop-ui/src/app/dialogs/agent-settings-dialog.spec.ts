import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  type CliOperationRequest,
  type AccountProfile,
  ModelProfile,
  ModelProfileInput,
  NetworkProfile,
  NetworkProfileInput,
} from '../core/models/agent.models';
import { AgentSettingsDialogComponent } from './agent-settings-dialog';

type CliRequest = CliOperationRequest;

const CUSTOM_PROFILE: ModelProfile = {
  id: 'custom-default',
  name: 'Team Claude',
  provider: 'Anthropic',
  isDefault: true,
  hasCredential: true,
  claudeEnabled: true,
  claudeModel: 'claude-sonnet-4-6',
  claudeBaseUrl: 'https://api.example.test',
  codexEnabled: false,
  codexModel: '',
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
    window.localStorage.setItem('termexo.language', 'zh-CN');
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

    // Name, Claude model + endpoint, Codex model + endpoint, then the shared API key.
    expect(inputs[0].value).toBe('Team Claude');
    expect(inputs[1].value).toBe('claude-sonnet-4-6');
    expect(inputs[2].value).toBe('https://api.example.test');
    expect(inputs[5].placeholder).toContain('已安全保存');
  });

  it('reuses the generated id when a new profile is saved more than once', async () => {
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('模型 Profile');
    clickButton('新建 Profile');
    await fixture.whenStable();
    expect(component['modelId']()).toBe('');
    component['selectTab']('diagnostics');
    component['selectTab']('models');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['modelId']()).toBe('');
    setEditorInputValue(0, 'New Profile');
    setEditorInputValue(1, 'sonnet');

    const savedIds: string[] = [];
    component.modelSaved.subscribe((profile) => savedIds.push(profile.id));
    clickButton('保存 Profile');
    clickButton('保存 Profile');

    expect(savedIds).toHaveLength(2);
    expect(savedIds[0]).toBeTruthy();
    expect(savedIds[0]).not.toBe(CUSTOM_PROFILE.id);
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

    // Name, then Claude model + endpoint, then Codex model + endpoint, then the shared key.
    const inputs = root.querySelectorAll<HTMLInputElement>(
      '.profile-editor input:not([type="checkbox"])',
    );
    expect(inputs[0].value).toBe('DeepSeek 深度求索');
    expect(inputs[1].value).toBe('deepseek-v4-pro[1m]');
    expect(inputs[2].value).toBe('https://api.deepseek.com/anthropic');
    expect(inputs[3].value).toBe('deepseek-v4');
    expect(inputs[4].value).toBe('https://api.deepseek.com/v1');
    setEditorInputValue(5, 'test-deepseek-key');

    const saved: ModelProfileInput[] = [];
    component.modelSaved.subscribe((profile) => saved.push(profile));
    clickButton('保存 Profile');
    expect(saved[0]).toEqual(
      expect.objectContaining({
        provider: 'DeepSeek',
        claudeEnabled: true,
        claudeModel: 'deepseek-v4-pro[1m]',
        claudeBaseUrl: 'https://api.deepseek.com/anthropic',
        codexEnabled: true,
        codexModel: 'deepseek-v4',
        codexBaseUrl: 'https://api.deepseek.com/v1',
      }),
    );
  });

  it('opens a requested third-party profile and requires its missing API key', async () => {
    const minimax: ModelProfile = {
      id: 'minimax-m3',
      name: 'MiniMax M3',
      provider: 'MiniMax',
      isDefault: false,
      hasCredential: false,
      claudeEnabled: true,
      claudeModel: 'MiniMax-M3',
      claudeBaseUrl: 'https://api.minimaxi.com/anthropic',
      codexEnabled: true,
      codexModel: 'MiniMax-M3',
      codexBaseUrl: 'https://api.minimaxi.com/v1',
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

    setEditorInputValue(5, 'test-minimax-key');
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
    const requests: CliRequest[] = [];
    component.cliPreviewRequested.subscribe((request) => requests.push(request));
    clickButton('生成安装计划');

    expect(requests).toEqual([
      {
        agentType: 'claude',
        installer: 'npm',
        targetVersion: '0.145.0',
        workspaceId: 'workspace-1',
      },
    ]);
  });

  it('asks for no version when the agent is installed by its own script', async () => {
    fixture.componentRef.setInput('activeWorkspaceId', 'workspace-1');
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('CLI 安装与升级');
    setLabeledInputValue('目标版本', '0.145.0');
    clickButton('Antigravity');
    fixture.detectChanges();

    // The version box is gone, and the request carries no version for the script to ignore.
    expect(root.textContent).toContain('官方脚本始终安装');
    const requests: CliRequest[] = [];
    component.cliPreviewRequested.subscribe((request) => requests.push(request));
    clickButton('生成安装计划');

    expect(requests).toEqual([
      {
        agentType: 'antigravity',
        installer: 'script',
        targetVersion: undefined,
        workspaceId: 'workspace-1',
      },
    ]);
  });

  /** Claude Code publishes both, so the choice is the user's rather than Termexo's. */
  it('can install an npm-published agent from its vendor script instead', async () => {
    fixture.componentRef.setInput('activeWorkspaceId', 'workspace-1');
    fixture.detectChanges();
    await fixture.whenStable();

    clickButton('CLI 安装与升级');
    setLabeledInputValue('目标版本', '0.145.0');
    clickButton('官方脚本');
    fixture.detectChanges();

    const requests: CliRequest[] = [];
    component.cliPreviewRequested.subscribe((request) => requests.push(request));
    clickButton('生成安装计划');

    expect(requests).toEqual([
      {
        agentType: 'claude',
        installer: 'script',
        targetVersion: undefined,
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
      installer: 'npm',
      supportsVersion: true,
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

  it('retains separate drafts across profiles and categories, including a new profile', async () => {
    const second = { ...CUSTOM_PROFILE, id: 'second', name: 'Second', isDefault: false };
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE, second]);
    fixture.detectChanges();
    await fixture.whenStable();
    component['editModel'](CUSTOM_PROFILE);
    component['modelName'] = 'Unsaved first';
    component['editModel'](second);
    component['modelName'] = 'Unsaved second';
    component['editModel'](CUSTOM_PROFILE);
    expect(component['modelName']).toBe('Unsaved first');
    component['editModel'](second);
    expect(component['modelName']).toBe('Unsaved second');
    component['newModel']();
    component['modelName'] = 'New draft';
    component['selectTab']('diagnostics');
    component['selectTab']('models');
    expect(component['modelName']).toBe('New draft');
    component['requestClose']();
    expect(component['confirmClose']()).toBe(true);
  });

  it('keeps an unacknowledged save dirty and clears it only after a successful save', async () => {
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();
    component['modelName'] = 'Saved name';
    component['apiKey'] = 'test-credential';
    component['saveModel']();
    expect(component['modelDirty']()).toBe(true);
    expect(component['apiKey']).toBe('test-credential');
    fixture.componentRef.setInput('profileSaveCompleted', {
      kind: 'models',
      id: CUSTOM_PROFILE.id,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['modelDirty']()).toBe(false);
    expect(component['apiKey']).toBe('');
    component['editModel'](CUSTOM_PROFILE);
    expect(component['modelName']).toBe('Saved name');
    let closed = false;
    component.cancelled.subscribe(() => (closed = true));
    component['requestClose']();
    expect(closed).toBe(true);
  });

  it('does not overwrite edits made while a save is awaiting acknowledgement', async () => {
    fixture.componentRef.setInput('modelProfiles', [CUSTOM_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();
    component['modelName'] = 'Submitted';
    component['saveModel']();
    component['modelName'] = 'Typed later';
    fixture.componentRef.setInput('profileSaveCompleted', {
      kind: 'models',
      id: CUSTOM_PROFILE.id,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['modelName']).toBe('Typed later');
    expect(component['modelDirty']()).toBe(true);
  });

  it('rejects malformed MCP JSON and a non-object root before emitting a save', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const saves: unknown[] = [];
    component.mcpSaved.subscribe((value) => saves.push(value));
    component['mcpName'] = 'MCP';
    for (const json of ['{broken', 'null', '[]']) {
      component['mcpConfig'] = json;
      component['saveMcp']();
      expect(component['mcpError']()).toBeTruthy();
    }
    expect(saves).toHaveLength(0);
    component['mcpConfig'] = '{"mcpServers":{}}';
    component['saveMcp']();
    expect(saves).toHaveLength(1);
  });

  it('retains account and MCP drafts across records, refreshes and category changes', async () => {
    const accounts: AccountProfile[] = ['a', 'b'].map((id) => ({
      id,
      name: id,
      agentType: 'claude',
      isDefault: id === 'a',
      isSystem: false,
      authenticated: false,
      diagnostic: '',
    }));
    const mcps = ['a', 'b'].map((id) => ({ id, name: id, configJson: '{}' }));
    fixture.componentRef.setInput('accountProfiles', accounts);
    fixture.componentRef.setInput('mcpProfiles', mcps);
    fixture.detectChanges();
    await fixture.whenStable();
    component['accountName'] = 'Account draft';
    component['editAccount'](accounts[1]);
    component['editAccount'](accounts[0]);
    expect(component['accountName']).toBe('Account draft');
    component['mcpConfig'] = '{unfinished';
    component['editMcp'](mcps[1]);
    component['editMcp'](mcps[0]);
    expect(component['mcpConfig']).toBe('{unfinished');
    fixture.componentRef.setInput(
      'accountProfiles',
      accounts.map((a) => ({ ...a, diagnostic: 'Refreshed' })),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['accountName']).toBe('Account draft');
    component['newMcp']();
    component['mcpName'] = 'New draft';
    component['selectTab']('diagnostics');
    component['selectTab']('mcp');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['mcpId']()).toBe('');
    expect(component['mcpName']).toBe('New draft');
    component['requestClose']();
    expect(component['confirmClose']()).toBe(true);
  });

  it('acknowledges account and MCP saves independently without discarding later edits', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    component['accountName'] = 'Submitted account';
    component['saveAccount']();
    const accountId = component['accountId']();
    component['mcpName'] = 'Submitted MCP';
    component['saveMcp']();
    const mcpId = component['mcpId']();
    expect(component['accountDirty']()).toBe(true);
    expect(component['mcpDirty']()).toBe(true);
    component['mcpName'] = 'Typed after save';
    fixture.componentRef.setInput('profileSaveCompleted', { kind: 'accounts', id: accountId });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['accountDirty']()).toBe(false);
    expect(component['mcpDirty']()).toBe(true);
    fixture.componentRef.setInput('profileSaveCompleted', { kind: 'mcp', id: mcpId });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['mcpName']).toBe('Typed after save');
    expect(component['mcpDirty']()).toBe(true);
  });

  it('keeps network passwords and drafts until successful persistence and clears only submitted credentials', async () => {
    fixture.componentRef.setInput('networkProfiles', [
      { ...NETWORK_PROFILE, hasCredential: false },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    component['proxyPassword'] = 'test-only-password';
    component['saveNetwork']();
    expect(component['hasNetworkCredential']()).toBe(false);
    expect(component['proxyPassword']).toBe('test-only-password');
    expect(component['networkDirty']()).toBe(true);
    component['networkName'] = 'Typed while saving';
    fixture.componentRef.setInput('networkProfiles', [NETWORK_PROFILE]);
    fixture.componentRef.setInput('profileSaveCompleted', {
      kind: 'network',
      id: NETWORK_PROFILE.id,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['proxyPassword']).toBe('');
    expect(component['hasNetworkCredential']()).toBe(true);
    expect(component['networkName']).toBe('Typed while saving');
    expect(component['networkDirty']()).toBe(true);
  });

  it('does not test stale saved network settings while the form contains edits', async () => {
    fixture.componentRef.setInput('networkProfiles', [NETWORK_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();
    clickButton('网络与 npm');
    setLabeledInputValue('HTTPS_PROXY', 'http://changed.example:8080');
    const tested: string[] = [];
    component.networkTestRequested.subscribe((id) => tested.push(id));
    clickButton('测试连接');
    expect(tested).toEqual([]);
    clickButton('保存代理 Profile');
    fixture.componentRef.setInput('profileSaveCompleted', {
      kind: 'network',
      id: NETWORK_PROFILE.id,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    clickButton('测试连接');
    expect(tested).toEqual([NETWORK_PROFILE.id]);
  });

  it('protects an unedited new default after a failed creation, and forgets drafts of deleted profiles', async () => {
    fixture.componentRef.setInput('networkProfiles', [NETWORK_PROFILE]);
    fixture.detectChanges();
    await fixture.whenStable();
    component['networkName'] = 'About to be deleted';
    component['editNetwork']({ ...NETWORK_PROFILE, id: 'second', name: 'Second' });
    fixture.componentRef.setInput('networkProfiles', [
      { ...NETWORK_PROFILE, id: 'second', name: 'Second' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    let closed = false;
    component.cancelled.subscribe(() => (closed = true));
    component['requestClose']();
    expect(closed).toBe(true);
    component['newNetwork']();
    component['saveNetwork']();
    expect(component['networkDirty']()).toBe(true);
    component['requestClose']();
    expect(component['confirmClose']()).toBe(true);
  });

  it('closes while agents are being detected, but not while a profile save is in flight', () => {
    let closed = false;
    component.cancelled.subscribe(() => (closed = true));

    fixture.componentRef.setInput('busy', true);
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    component['requestClose']();
    expect(closed).toBe(false);

    fixture.componentRef.setInput('saving', false);
    fixture.detectChanges();
    component['requestClose']();
    expect(closed).toBe(true);
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
