import { type Signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { type AgentType } from './core/models/workspace.models';
import { AppStateService } from './core/services/app-state.service';
import { WorkspaceRepository } from './core/services/workspace.repository';

interface OnboardingFlow {
  launchFromOnboarding(type: AgentType): void;
  createWorkspace(value: { name: string; projectPath: string }): Promise<void>;
  cancelWorkspaceCreation(): void;
  createWorkspaceOpen: WritableSignal<boolean>;
  creatingWorkspace: Signal<boolean>;
  createWorkspaceError: Signal<string | null>;
  codexLaunchOpen: Signal<boolean>;
  claudeLaunchOpen: Signal<boolean>;
  selectedTerminalDirectory: Signal<string | null>;
}

describe('App onboarding flow', () => {
  let flow: OnboardingFlow;
  let state: AppStateService;
  const repository = { save: vi.fn<WorkspaceRepository['save']>() };
  const project = { name: 'First project', projectPath: 'D:\\dev\\first' };

  beforeEach(() => {
    repository.save.mockReset().mockResolvedValue(undefined);
    // Exercise the real App and AppStateService with an empty initial state, without
    // loading preview projects, probing CLIs or starting background polling.
    vi.spyOn(
      App.prototype as unknown as { initialize(): Promise<void> },
      'initialize',
    ).mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: WorkspaceRepository, useValue: repository }],
    });
    const fixture = TestBed.createComponent(App);
    flow = fixture.componentInstance as unknown as OnboardingFlow;
    state = TestBed.inject(AppStateService);
  });

  afterEach(() => vi.restoreAllMocks());

  it('waits for persistence and opens the picked Agent once, with the newly saved path', async () => {
    let finishSave!: () => void;
    repository.save.mockReturnValueOnce(new Promise<void>((resolve) => (finishSave = resolve)));
    flow.launchFromOnboarding('codex');
    expect(flow.createWorkspaceOpen()).toBe(true);
    const creating = flow.createWorkspace(project);

    expect(flow.creatingWorkspace()).toBe(true);
    expect(flow.codexLaunchOpen()).toBe(false);
    await flow.createWorkspace(project);
    flow.cancelWorkspaceCreation();
    expect(flow.createWorkspaceOpen()).toBe(true);
    expect(repository.save).toHaveBeenCalledOnce();

    finishSave();
    await creating;
    expect(flow.creatingWorkspace()).toBe(false);
    expect(flow.createWorkspaceOpen()).toBe(false);
    expect(flow.codexLaunchOpen()).toBe(true);
    expect(flow.claudeLaunchOpen()).toBe(false);
    expect(flow.selectedTerminalDirectory()).toBe(project.projectPath);
    expect(state.workspaces()).toHaveLength(1);
    expect(state.activeWorkspace()?.terminals).toEqual([]);
  });

  it('keeps the chosen Agent and create dialog after failure, then resumes on retry', async () => {
    repository.save.mockRejectedValueOnce(new Error('Disk is full'));
    flow.launchFromOnboarding('codex');
    await flow.createWorkspace(project);
    expect(flow.createWorkspaceOpen()).toBe(true);
    expect(flow.createWorkspaceError()).toBe('Disk is full');
    expect(flow.creatingWorkspace()).toBe(false);
    expect(flow.codexLaunchOpen()).toBe(false);
    expect(state.workspaces()).toEqual([]);

    await flow.createWorkspace(project);
    expect(flow.createWorkspaceError()).toBeNull();
    expect(flow.createWorkspaceOpen()).toBe(false);
    expect(flow.codexLaunchOpen()).toBe(true);
    expect(state.workspaces()).toHaveLength(1);
  });

  it('discards a cancelled Agent choice before a later manual workspace creation', async () => {
    flow.launchFromOnboarding('codex');
    flow.cancelWorkspaceCreation();
    expect(flow.createWorkspaceOpen()).toBe(false);
    flow.createWorkspaceOpen.set(true);
    await flow.createWorkspace(project);
    expect(flow.codexLaunchOpen()).toBe(false);

    flow.launchFromOnboarding('claude');
    expect(flow.claudeLaunchOpen()).toBe(true);
    expect(flow.selectedTerminalDirectory()).toBe(project.projectPath);
    expect(repository.save).toHaveBeenCalledOnce();
  });
});
