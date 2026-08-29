import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  type AgentInstallation,
  type AgentSession,
  type ModelProfile,
} from '../core/models/agent.models';
import { type ResumeSessionValue, SessionCenterDialogComponent } from './session-center-dialog';

const CLAUDE_INSTALLATION: AgentInstallation = {
  agentType: 'claude',
  installed: true,
  executablePath: 'claude',
  version: '2.1.220',
  healthy: true,
  diagnostic: 'Claude Code 已连接',
};

const CODEX_INSTALLATION: AgentInstallation = {
  agentType: 'codex',
  installed: true,
  executablePath: 'codex',
  version: '0.145.0',
  healthy: true,
  diagnostic: 'Codex CLI 已连接',
};

const OPENCODE_INSTALLATION: AgentInstallation = {
  agentType: 'opencode',
  installed: true,
  executablePath: 'opencode',
  version: '1.18.21',
  healthy: true,
  diagnostic: 'OpenCode 已连接',
};

const SESSIONS: AgentSession[] = [
  {
    id: 'claude:claude-native-session',
    agentType: 'claude',
    nativeSessionId: 'claude-native-session',
    projectPath: 'D:\\devlop\\Termexo',
    modelName: 'Claude Sonnet',
    title: '完善会话中心',
    branch: 'main',
    status: 'idle',
    messageCount: 18,
    transcriptPath: 'claude.jsonl',
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_100_000,
  },
  {
    id: 'codex:codex-native-session',
    agentType: 'codex',
    nativeSessionId: 'codex-native-session',
    projectPath: 'D:\\devlop\\DataView',
    modelName: 'gpt-5.6-codex',
    title: 'Codex adapter',
    branch: 'feature/codex',
    status: 'idle',
    messageCount: 7,
    transcriptPath: 'rollout.jsonl',
    createdAt: 1_700_000_200_000,
    lastUsedAt: 1_700_000_300_000,
  },
  {
    id: 'opencode:opencode-native-session',
    agentType: 'opencode',
    nativeSessionId: 'opencode-native-session',
    projectPath: 'D:\\devlop\\Termexo',
    title: 'OpenCode adapter',
    status: 'idle',
    messageCount: 0,
    transcriptPath: 'opencode://session/opencode-native-session',
    createdAt: 1_700_000_400_000,
    lastUsedAt: 1_700_000_500_000,
  },
];

const DEFAULT_PROFILE: ModelProfile = {
  id: 'claude-default',
  name: 'Claude Sonnet',
  provider: 'Anthropic',
  claudeEnabled: true,
  claudeModel: 'sonnet',
  codexEnabled: false,
  codexModel: '',
  isDefault: true,
  hasCredential: false,
};

const THIRD_PARTY_PROFILE: ModelProfile = {
  id: 'glm-4-6',
  name: 'GLM 5.2',
  provider: 'GLM',
  claudeEnabled: true,
  claudeModel: 'glm-5.2[1m]',
  codexEnabled: true,
  codexModel: 'glm-5.2',
  claudeBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
  codexBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  isDefault: false,
  hasCredential: true,
};

describe('SessionCenterDialogComponent', () => {
  let fixture: ComponentFixture<SessionCenterDialogComponent>;
  let component: SessionCenterDialogComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionCenterDialogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionCenterDialogComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('installation', CLAUDE_INSTALLATION);
    fixture.componentRef.setInput('codexInstallation', CODEX_INSTALLATION);
    fixture.componentRef.setInput('openCodeInstallation', OPENCODE_INSTALLATION);
    fixture.componentRef.setInput('sessions', SESSIONS);
    fixture.componentRef.setInput('profiles', [DEFAULT_PROFILE]);
    fixture.componentRef.setInput('projectPath', 'D:\\devlop\\Termexo');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows Agent health, counts, and filters the session list by Agent', () => {
    expect(root.querySelectorAll('.agent-health')).toHaveLength(3);
    expect(root.querySelectorAll('.session-row')).toHaveLength(3);

    clickButton('Codex');

    const rows = root.querySelectorAll<HTMLElement>('.session-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Codex adapter');
    expect(rows[0].textContent).not.toContain('完善会话中心');
  });

  it('resumes OpenCode sessions without applying Claude or Codex profiles', () => {
    const resumed: ResumeSessionValue[] = [];
    component.resumed.subscribe((value) => resumed.push(value));

    clickResumeFor('OpenCode adapter');

    expect(resumed).toEqual([{ session: SESSIONS[2], model: undefined }]);
  });

  it('searches native session ids and emits the selected scan scope', async () => {
    const input = root.querySelector<HTMLInputElement>('.dialog-search input');
    expect(input).toBeTruthy();
    input!.value = 'codex-native';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelectorAll('.session-row')).toHaveLength(1);
    expect(root.querySelector('.session-row')?.textContent).toContain('Codex adapter');

    const scans: Array<string | undefined> = [];
    component.refreshed.subscribe((projectPath) => scans.push(projectPath));
    const scope = root.querySelector<HTMLInputElement>('.scope-control input');
    expect(scope).toBeTruthy();
    scope!.click();
    fixture.detectChanges();

    expect(scans).toEqual([undefined]);
  });

  it('applies Claude profiles only to Claude resume requests', () => {
    const resumed: ResumeSessionValue[] = [];
    component.resumed.subscribe((value) => resumed.push(value));

    clickResumeFor('完善会话中心');
    clickResumeFor('Codex adapter');

    expect(resumed[0]).toEqual({
      session: SESSIONS[0],
      profileId: 'claude-default',
      mcpProfileId: undefined,
    });
    expect(resumed[1]).toEqual({
      session: SESSIONS[1],
      profileId: undefined,
      mcpProfileId: undefined,
      accountProfileId: undefined,
      model: 'gpt-5.6-codex',
    });
  });

  it('resumes with the profile the session last ran with, not the default', () => {
    fixture.componentRef.setInput('profiles', [DEFAULT_PROFILE, THIRD_PARTY_PROFILE]);
    fixture.componentRef.setInput('sessionLaunchProfiles', (nativeSessionId: string) =>
      nativeSessionId === 'claude-native-session' ? { profileId: 'glm-4-6' } : null,
    );
    fixture.detectChanges();

    const resumed: ResumeSessionValue[] = [];
    component.resumed.subscribe((value) => resumed.push(value));

    clickResumeFor('完善会话中心');

    expect(resumed[0].profileId).toBe('glm-4-6');
  });

  it('lets an explicit profile pick override the previously used one', async () => {
    fixture.componentRef.setInput('profiles', [DEFAULT_PROFILE, THIRD_PARTY_PROFILE]);
    fixture.componentRef.setInput('sessionLaunchProfiles', () => ({ profileId: 'glm-4-6' }));
    fixture.detectChanges();

    root.querySelector<HTMLButtonElement>('.resume-config-toggle')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const select = root.querySelector<HTMLSelectElement>('.resume-options select');
    select!.value = 'claude-default';
    select!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();

    const resumed: ResumeSessionValue[] = [];
    component.resumed.subscribe((value) => resumed.push(value));

    clickResumeFor('完善会话中心');

    expect(resumed[0].profileId).toBe('claude-default');
  });

  it('can resume a session with automatic confirmation enabled', async () => {
    root.querySelector<HTMLButtonElement>('.resume-config-toggle')!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    root.querySelector<HTMLInputElement>('.resume-auto-confirm input')!.click();
    fixture.detectChanges();

    const resumed: ResumeSessionValue[] = [];
    component.resumed.subscribe((value) => resumed.push(value));
    clickResumeFor('Codex adapter');

    expect(resumed[0]).toEqual(expect.objectContaining({ autoConfirm: true }));
  });

  function clickButton(label: string): void {
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim().startsWith(label),
    );
    expect(button).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  }

  function clickResumeFor(title: string): void {
    const row = Array.from(root.querySelectorAll<HTMLElement>('.session-row')).find((candidate) =>
      candidate.textContent?.includes(title),
    );
    expect(row).toBeTruthy();
    row!.querySelector<HTMLButtonElement>('.resume-button')!.click();
    fixture.detectChanges();
  }
});
