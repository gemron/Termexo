import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModelProfile, ModelProfileInput } from '../core/models/agent.models';
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

    const saved: ModelProfileInput[] = [];
    component.modelSaved.subscribe((profile) => saved.push(profile));
    clickButton('保存 Profile');
    expect(saved[0]).toEqual(expect.objectContaining({ provider: 'DeepSeek' }));
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
});
