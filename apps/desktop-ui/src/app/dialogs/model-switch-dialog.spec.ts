import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CLI_NATIVE_PROFILE_ID } from '../core/models/launch-model-choice';
import { CodexModelCatalogService } from '../core/services/codex-model-catalog.service';
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
    await TestBed.configureTestingModule({
      imports: [ModelSwitchDialogComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ModelSwitchDialogComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('profiles', [OPENAI, MINIMAX]);
    fixture.componentRef.setInput('lockedAgentType', 'codex');
    fixture.componentRef.setInput('singleTerminalName', 'Codex 1');
    fixture.componentRef.setInput('currentProfileId', 'minimax');
    fixture.componentRef.setInput('currentModel', 'MiniMax-M3');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function choose(value: string): void {
    const select = root.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  const confirm = () => root.querySelector<HTMLButtonElement>('footer .primary')!;

  it('names the running model and waits for an explicit choice', () => {
    expect(root.querySelector('.switch-current')?.textContent).toContain('MiniMax-M3');
    expect(root.querySelector<HTMLOptionElement>('option[value="minimax"]')?.disabled).toBe(true);
    expect(confirm().disabled).toBe(true);
    const values: ModelSwitchValue[] = [];
    component.confirmed.subscribe((v) => values.push(v));
    choose('openai');
    confirm().click();
    expect(values).toEqual([{ profileId: 'openai', agent: 'codex' }]);
  });

  it('allows the built-in default without saved profiles and blocks reapplying it', async () => {
    fixture.componentRef.setInput('profiles', []);
    fixture.detectChanges();
    choose('official:');
    const values: ModelSwitchValue[] = [];
    component.confirmed.subscribe((v) => values.push(v));
    confirm().click();
    expect(values).toEqual([
      { profileId: CLI_NATIVE_PROFILE_ID, agent: 'codex', model: undefined },
    ]);
    fixture.componentRef.setInput('currentProfileId', CLI_NATIVE_PROFILE_ID);
    fixture.componentRef.setInput('currentModel', 'Codex default model');
    fixture.detectChanges();
    expect(confirm().disabled).toBe(true);
  });

  it('can apply a newer model saved under the running profile ID', async () => {
    fixture.componentRef.setInput('profiles', [{ ...MINIMAX, codexModel: 'updated-model' }]);
    fixture.detectChanges();
    await fixture.whenStable();
    choose('minimax');
    expect(confirm().disabled).toBe(false);
    const switched = vi.fn();
    component.confirmed.subscribe(switched);
    confirm().click();
    expect(switched).toHaveBeenCalledWith({ agent: 'codex', profileId: 'minimax' });
  });

  it('loads official choices for the target account and directory', async () => {
    const load = vi.spyOn(TestBed.inject(CodexModelCatalogService), 'load').mockResolvedValue({
      source: 'cli',
      configuredDefault: null,
      models: [
        {
          id: 'codex-demo',
          displayName: 'Demo model',
          isDefault: false,
          supportedReasoningEfforts: [],
        },
      ],
    });
    fixture.componentRef.setInput('accountId', 'work-account');
    fixture.componentRef.setInput('directory', '/work');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(load).toHaveBeenCalledWith('work-account', '/work');
    choose('official:codex-demo');
    const values: ModelSwitchValue[] = [];
    component.confirmed.subscribe((v) => values.push(v));
    confirm().click();
    expect(values).toEqual([
      { profileId: CLI_NATIVE_PROFILE_ID, agent: 'codex', model: 'codex-demo' },
    ]);
  });

  it('can manage settings without selecting a switch destination', () => {
    const settings = vi.fn();
    component.settingsRequested.subscribe(settings);
    root.querySelector<HTMLButtonElement>('.manage-profile')!.click();
    expect(settings).toHaveBeenCalledWith({ profileId: 'minimax', choice: '' });
  });

  it('opens the selected profile for a missing key without confirming a restart', () => {
    fixture.componentRef.setInput('profiles', [
      { ...MINIMAX, id: 'missing', hasCredential: false },
    ]);
    fixture.detectChanges();
    choose('missing');
    const settings = vi.fn(),
      switched = vi.fn();
    component.settingsRequested.subscribe(settings);
    component.confirmed.subscribe(switched);
    confirm().click();
    expect(settings).toHaveBeenCalledWith({ profileId: 'missing', choice: 'missing' });
    expect(switched).not.toHaveBeenCalled();
  });
});
