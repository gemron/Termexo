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
];

const DEFAULT_PROFILE: ModelProfile = {
  id: 'claude-default',
  name: 'Claude Sonnet',
  provider: 'Anthropic',
  model: 'sonnet',
  isDefault: true,
  hasCredential: false,
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
    fixture.componentRef.setInput('sessions', SESSIONS);
    fixture.componentRef.setInput('profiles', [DEFAULT_PROFILE]);
    fixture.componentRef.setInput('projectPath', 'D:\\devlop\\Termexo');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows Agent health, counts, and filters the session list by Agent', () => {
    expect(root.querySelectorAll('.agent-health')).toHaveLength(2);
    expect(root.querySelectorAll('.session-row')).toHaveLength(2);

    clickButton('Codex');

    const rows = root.querySelectorAll<HTMLElement>('.session-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Codex adapter');
    expect(rows[0].textContent).not.toContain('完善会话中心');
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
