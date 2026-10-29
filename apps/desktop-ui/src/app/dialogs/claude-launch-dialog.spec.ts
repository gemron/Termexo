import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { ClaudeLaunchDialogComponent, type ClaudeLaunchDialogValue } from './claude-launch-dialog';
import { ModelCatalogService } from '../core/services/model-catalog.service';
import type { CatalogModel } from '../core/models/model-catalog';
import { CLI_NATIVE_PROFILE_ID } from '../core/models/launch-model-choice';
import type { ModelProfile } from '../core/models/agent.models';

const custom = { id: 'custom', name: 'My provider', provider: 'custom', isDefault: true, claudeEnabled: true, claudeModel: 'provider-model', hasCredential: true } as ModelProfile;
describe('Claude launch model selection', () => {
  let fixture: ComponentFixture<ClaudeLaunchDialogComponent>;
  let root: HTMLElement;
  const models = signal<CatalogModel[]>([]);
  beforeEach(async () => {
    models.set([{ id: 'claude-current', name: 'Current Claude', provider: 'Anthropic', family: 'claude', releaseDate: '', retired: false }]);
    await TestBed.configureTestingModule({ imports: [ClaudeLaunchDialogComponent], providers: [{ provide: ModelCatalogService, useValue: {
      choices: () => models(), refresh: vi.fn().mockResolvedValue(undefined), loading: signal(false),
    } }] }).compileComponents();
    fixture = TestBed.createComponent(ClaudeLaunchDialogComponent);
    fixture.componentRef.setInput('installation', { agentType: 'claude', installed: true, healthy: true, version: 'current', executablePath: 'claude', diagnostic: '' });
    fixture.componentRef.setInput('profiles', [custom]);
    fixture.componentRef.setInput('accountProfiles', [{ id: 'claude-system', agentType: 'claude', name: 'System Claude', isDefault: true, isSystem: true, authenticated: true, diagnostic: '' }]);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); root = fixture.nativeElement;
  });
  function choose(value: string) {
    const select = root.querySelector<HTMLSelectElement>('.profile-field select')!;
    select.value = value; select.dispatchEvent(new Event('change')); fixture.detectChanges();
  }
  it('launches an official model independently of a custom default and preserves account selection', () => {
    expect(root.querySelector('option[value="custom"]')).not.toBeNull();
    expect(root.querySelector('option[value="official:claude-current"]')).not.toBeNull();
    choose('official:claude-current');
    const launches: ClaudeLaunchDialogValue[] = [];
    fixture.componentInstance.launched.subscribe(value => launches.push(value));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    expect(launches[0]).toMatchObject({ model: 'claude-current', profileId: CLI_NATIVE_PROFILE_ID, accountProfileId: 'claude-system' });
    choose('custom'); root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    expect(launches[1].profileId).toBe('custom'); expect(launches[1].model).toBeUndefined();
  });
  it('starts through the CLI default with no saved profile', async () => {
    fixture.componentRef.setInput('profiles', []); fixture.detectChanges(); await fixture.whenStable();
    const launches: ClaudeLaunchDialogValue[] = [];
    fixture.componentInstance.launched.subscribe(value => launches.push(value));
    root.querySelector<HTMLButtonElement>('footer .primary')!.click();
    expect(launches[0].profileId).toBe(CLI_NATIVE_PROFILE_ID); expect(launches[0].model).toBeUndefined();
  });
  it('does not replace a chosen official model when the catalog refreshes', () => {
    choose('official:claude-current'); models.set([]); fixture.detectChanges();
    expect(root.querySelector<HTMLSelectElement>('.profile-field select')!.value).toBe('official:claude-current');
    expect(root.querySelector('option[value="official:claude-current"]')).not.toBeNull();
  });
});
