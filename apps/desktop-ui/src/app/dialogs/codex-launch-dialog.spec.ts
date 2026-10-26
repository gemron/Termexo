import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  type AccountProfile,
  type AgentInstallation,
  type ModelProfile,
} from '../core/models/agent.models';
import { CodexLaunchDialogComponent, type CodexLaunchDialogValue } from './codex-launch-dialog';
import { CodexModelCatalogService } from '../core/services/codex-model-catalog.service';
import { CLI_NATIVE_PROFILE_ID } from '../core/models/launch-model-choice';

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
  const catalogs = { load: vi.fn() };

  beforeEach(async () => {
    catalogs.load.mockResolvedValue({ source: 'codex-app-server', configuredDefault: null, models: [] });
    await TestBed.configureTestingModule({
      imports: [CodexLaunchDialogComponent],
      providers: [{ provide: CodexModelCatalogService, useValue: catalogs }],
    }).compileComponents();
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

  it('offers official CLI models beside saved profiles even with a third-party default', async () => {
    catalogs.load.mockResolvedValue({ source: 'codex-app-server', configuredDefault: 'cli-current', models: [{ id: 'cli-current', isDefault: true }] });
    await component['refreshModels'](); fixture.detectChanges();
    const select = root.querySelector<HTMLSelectElement>('.profile-field select')!;
    expect(select.querySelector('option[value="official:cli-current"]')).not.toBeNull();
    expect(select.querySelector('option[value="minimax"]')).not.toBeNull();
    select.value = 'official:cli-current'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
    const launches: CodexLaunchDialogValue[] = [];
    component.launched.subscribe(value => launches.push(value));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    expect(launches[0]).toMatchObject({ model: 'cli-current', profileId: CLI_NATIVE_PROFILE_ID, accountProfileId: ACCOUNT.id });
    select.value = 'minimax'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    expect(launches[1]).toMatchObject({ model: 'MiniMax-M3', profileId: MINIMAX.id });
  });

  it('can use the native CLI default without requiring a saved model profile', async () => {
    fixture.componentRef.setInput('profiles', []); fixture.detectChanges(); await fixture.whenStable();
    const launches: CodexLaunchDialogValue[] = [];
    component.launched.subscribe(value => launches.push(value));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    expect(launches[0]).toMatchObject({ profileId: CLI_NATIVE_PROFILE_ID, accountProfileId: ACCOUNT.id });
    expect(launches[0].model).toBeUndefined();
  });

  it('loads current CLI models without replacing a user-selected model', async () => {
    catalogs.load.mockResolvedValue({ source: 'codex-app-server', configuredDefault: 'future-model', models: [{ id: 'future-model', isDefault: true }] });
    fixture.componentRef.setInput('profiles', [{ ...OPENAI, codexModel: '', isDefault: true }]);
    fixture.detectChanges();
    await component['refreshModels'](); fixture.detectChanges();
    expect(root.querySelectorAll('datalist option')).toHaveLength(1);
    expect(root.querySelector('datalist option')?.getAttribute('value')).toBe('future-model');
    expect(root.querySelector<HTMLInputElement>('.model-field input')?.placeholder).toBe('future-model');
    component['model'].set('user-pinned-model');
    await component['refreshModels'](); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('.model-field input')?.value).toBe('user-pinned-model');
  });

  it('keeps manual input available when model discovery fails', async () => {
    catalogs.load.mockRejectedValue(new Error('Disconnected'));
    fixture.componentRef.setInput('profiles', [{ ...OPENAI, isDefault: true }]);
    fixture.detectChanges(); await fixture.whenStable();
    component['model'].set('manual-model');
    await component['refreshModels'](); fixture.detectChanges();
    await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('.model-field input')?.value).toBe('manual-model');
    expect(root.textContent).toContain('无法读取 CLI 模型列表');
  });

  it('identifies One Ring coordination and hides automatic confirmation', () => {
    fixture.componentRef.setInput('oneRing', true);
    fixture.detectChanges();
    expect(root.textContent).toContain('One Ring · Codex Coordinator');
    expect(root.querySelector('.auto-confirm-control')).toBeNull();
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

  it('leaves the reasoning effort to the profile until the launch overrides it', async () => {
    const effort = root.querySelector<HTMLSelectElement>('.effort-field select')!;
    expect(effort.value).toBe('');

    const launches: CodexLaunchDialogValue[] = [];
    component.launched.subscribe((value) => launches.push(value));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    expect(launches[0].reasoningEffort).toBeUndefined();

    effort.value = 'xhigh';
    effort.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();

    expect(launches[1]).toEqual(expect.objectContaining({ reasoningEffort: 'xhigh' }));
  });

  it('emits automatic confirmation only after the user enables it', async () => {
    const autoConfirm = root.querySelector<HTMLInputElement>('.auto-confirm-control input')!;
    expect(autoConfirm.checked).toBe(false);
    autoConfirm.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const launches: CodexLaunchDialogValue[] = [];
    component.launched.subscribe((value) => launches.push(value));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();

    expect(launches[0]).toEqual(expect.objectContaining({ autoConfirm: true }));
  });
});
