import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  type AccountProfile,
  type AgentInstallation,
  type ModelProfile,
} from '../core/models/agent.models';
import { CodexLaunchDialogComponent, type CodexLaunchDialogValue } from './codex-launch-dialog';

const INSTALLATION: AgentInstallation = {
  agentType: 'codex',
  installed: true,
  executablePath: 'codex',
  version: '0.147.0',
  healthy: true,
  diagnostic: 'Codex CLI 已连接',
};

const ACCOUNT: AccountProfile = {
  id: 'codex-system',
  name: 'ChatGPT',
  agentType: 'codex',
  isDefault: true,
  isSystem: true,
  authenticated: true,
  diagnostic: '已登录',
};

const MINIMAX: ModelProfile = {
  id: 'minimax',
  name: 'MiniMax M3',
  provider: 'MiniMax',
  isDefault: true,
  hasCredential: true,
  claudeEnabled: false,
  claudeModel: '',
  codexEnabled: true,
  codexModel: 'MiniMax-M3',
  codexBaseUrl: 'https://api.minimaxi.com/v1',
};

const OPENAI: ModelProfile = {
  id: 'openai',
  name: 'GPT-5.6 Sol',
  provider: 'OpenAI',
  isDefault: false,
  hasCredential: false,
  claudeEnabled: false,
  claudeModel: '',
  codexEnabled: true,
  codexModel: 'gpt-5.6-sol',
};

describe('CodexLaunchDialogComponent', () => {
  let fixture: ComponentFixture<CodexLaunchDialogComponent>;
  let component: CodexLaunchDialogComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CodexLaunchDialogComponent] }).compileComponents();
    fixture = TestBed.createComponent(CodexLaunchDialogComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('installation', INSTALLATION);
    fixture.componentRef.setInput('accountProfiles', [ACCOUNT]);
    fixture.componentRef.setInput('profiles', [MINIMAX, OPENAI]);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows the model supplied by the selected profile before launch', () => {
    expect(root.querySelector<HTMLInputElement>('.model-field input')?.value).toBe('MiniMax-M3');
  });

  it('replaces a third-party model when the official profile is selected', async () => {
    const profile = root.querySelector<HTMLSelectElement>('.profile-field select')!;
    profile.value = 'openai';
    profile.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector<HTMLInputElement>('.model-field input')?.value).toBe('gpt-5.6-sol');

    const launches: CodexLaunchDialogValue[] = [];
    component.launched.subscribe((value) => launches.push(value));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    fixture.detectChanges();

    expect(launches).toEqual([
      {
        name: '',
        model: 'gpt-5.6-sol',
        profileId: 'openai',
        accountProfileId: 'codex-system',
      },
    ]);
  });
});
