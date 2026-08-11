import { ComponentFixture, TestBed } from '@angular/core/testing';

import { type ModelProfile } from '../core/models/agent.models';
import { ModelSwitchDialogComponent, type ModelSwitchValue } from './model-switch-dialog';

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

const MINIMAX: ModelProfile = {
  id: 'minimax',
  name: 'MiniMax M3',
  provider: 'MiniMax',
  isDefault: true,
  hasCredential: true,
  claudeEnabled: true,
  claudeModel: 'MiniMax-M3',
  codexEnabled: true,
  codexModel: 'MiniMax-M3',
  codexBaseUrl: 'https://api.minimaxi.com/v1',
};

describe('ModelSwitchDialogComponent', () => {
  let fixture: ComponentFixture<ModelSwitchDialogComponent>;
  let component: ModelSwitchDialogComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModelSwitchDialogComponent] }).compileComponents();
    fixture = TestBed.createComponent(ModelSwitchDialogComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('profiles', [OPENAI, MINIMAX]);
    fixture.componentRef.setInput('lockedAgentType', 'codex');
    fixture.componentRef.setInput('singleTerminalName', 'Codex 1');
    fixture.componentRef.setInput('currentProfileId', 'minimax');
    fixture.detectChanges();
  });

  it('shows and disables the profile already running in the terminal', () => {
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.profile-option'));
    const current = buttons.find((button) => button.textContent?.includes('MiniMax M3'));
    const alternative = buttons.find((button) => button.textContent?.includes('GPT-5.6 Sol'));

    expect(current?.disabled).toBe(true);
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(current?.textContent).toContain('Current');
    expect(alternative?.disabled).toBe(false);
    expect(alternative?.classList.contains('selected')).toBe(true);
  });

  it('emits only a switchable alternative', () => {
    const values: ModelSwitchValue[] = [];
    component.confirmed.subscribe((value) => values.push(value));

    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    fixture.detectChanges();

    expect(values).toEqual([{ profileId: 'openai', agent: 'codex' }]);
  });

  it('disables switching when the current profile is the only available profile', () => {
    fixture.componentRef.setInput('profiles', [MINIMAX]);
    fixture.detectChanges();

    expect(root.querySelector<HTMLButtonElement>('footer .primary')?.disabled).toBe(true);
  });
});
