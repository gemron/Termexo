import { ComponentFixture, TestBed } from '@angular/core/testing';

import { type ModelProfile, type ProviderQuota } from '../core/models/agent.models';
import { type TerminalSession } from '../core/models/workspace.models';
import { InspectorPanelComponent } from './inspector-panel';

const TERMINAL: TerminalSession = {
  id: 'terminal-1',
  name: 'Codex',
  workingDirectory: 'D:\\devlop\\Termexo',
  shell: 'powershell',
  agentType: 'codex',
  status: 'RUNNING',
  model: 'GLM 5.2',
  branch: 'main',
  profileId: 'glm-profile',
  accountProfileId: 'codex-account',
};

const QUOTAS: ProviderQuota[] = [
  {
    profileId: 'glm-profile',
    profileName: 'GLM 5.2',
    provider: 'GLM',
    official: true,
    entries: [],
    checkedAt: 1_700_000_000_000,
  },
  {
    profileId: 'agent:codex-account',
    profileName: 'Personal Codex',
    provider: 'Codex',
    official: false,
    entries: [],
    checkedAt: 1_700_000_000_000,
  },
  {
    profileId: 'deepseek-profile',
    profileName: 'DeepSeek Chat',
    provider: 'DeepSeek',
    official: true,
    entries: [],
    checkedAt: 1_700_000_000_000,
  },
  {
    profileId: 'openai-profile',
    profileName: 'OpenAI Official',
    provider: 'OpenAI',
    official: false,
    entries: [],
    checkedAt: 1_700_000_000_000,
  },
  {
    profileId: 'agent:other-codex-account',
    profileName: 'Work Codex',
    provider: 'Codex',
    official: false,
    entries: [],
    checkedAt: 1_700_000_000_000,
  },
];

const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'glm-profile',
    name: 'GLM 5.2',
    provider: 'GLM',
    isDefault: false,
    hasCredential: true,
    claudeEnabled: true,
    claudeModel: 'glm-5.2[1m]',
    claudeBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    codexEnabled: true,
    codexModel: 'glm-5.2',
    codexBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    id: 'openai-profile',
    name: 'OpenAI Official',
    provider: 'OpenAI',
    isDefault: false,
    hasCredential: false,
    claudeEnabled: false,
    claudeModel: '',
    codexEnabled: true,
    codexModel: 'gpt-5.6-sol',
  },
];

describe('InspectorPanelComponent provider allowances', () => {
  let fixture: ComponentFixture<InspectorPanelComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InspectorPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(InspectorPanelComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('activeTerminal', TERMINAL);
    fixture.componentRef.setInput('quotas', QUOTAS);
    fixture.componentRef.setInput('modelProfiles', MODEL_PROFILES);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('uses the model profile allowance for a third-party model', () => {
    const rows = root.querySelectorAll<HTMLElement>('.quota-row');

    expect(rows).toHaveLength(1);
    expect(root.textContent).toContain('GLM 5.2');
    expect(root.textContent).not.toContain('Personal Codex');
    expect(root.textContent).not.toContain('DeepSeek Chat');
  });

  it('uses only the selected login account allowance for an official model', async () => {
    fixture.componentRef.setInput('activeTerminal', {
      ...TERMINAL,
      model: 'OpenAI Official',
      profileId: 'openai-profile',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const rows = root.querySelectorAll<HTMLElement>('.quota-row');
    const quotaText = [...rows].map((row) => row.textContent).join(' ');
    expect(rows).toHaveLength(1);
    expect(quotaText).toContain('Personal Codex');
    expect(quotaText).not.toContain('OpenAI Official');
    expect(quotaText).not.toContain('Work Codex');
  });

  it('toggles between all providers and the active terminal providers', () => {
    const toggle = root.querySelector<HTMLButtonElement>('.quota-scope-toggle');
    expect(toggle).toBeTruthy();

    toggle!.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.quota-row')).toHaveLength(5);
    expect(root.textContent).toContain('DeepSeek Chat');
    expect(toggle!.getAttribute('aria-pressed')).toBe('true');

    toggle!.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.quota-row')).toHaveLength(1);
    expect(root.textContent).not.toContain('DeepSeek Chat');
  });
});
