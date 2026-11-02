import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AppStateService } from './core/services/app-state.service';
import { WorkspaceRepository } from './core/services/workspace.repository';
import type { TerminalExitEvent } from './core/services/terminal-gateway.service';

describe('terminal process exit', () => {
  let app: { handleTerminalExit(event: TerminalExitEvent): void };
  let state: AppStateService;
  beforeEach(async () => {
    vi.spyOn(App.prototype as unknown as { initialize(): Promise<void> }, 'initialize').mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } }] });
    TestBed.overrideComponent(App, { set: { template: '' } });
    await TestBed.compileComponents();
    app = TestBed.createComponent(App).componentInstance as unknown as typeof app;
    state = TestBed.inject(AppStateService);
    await state.createWorkspace('Linux project', '/tmp/project');
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { intentional: true, expected: 'STOPPED' },
    { intentional: false, expected: 'FAILED' },
  ])('records $expected for an unsuccessful exit with intentional=$intentional', ({ intentional, expected }) => {
    const terminal = state.createTerminal({ agentType: 'shell' })!;
    app.handleTerminalExit({ terminalId: terminal.id, runtimeRevision: terminal.runtimeRevision ?? 0, exitCode: 1, success: false, intentional });
    expect(state.activeWorkspace()?.terminals.find((item) => item.id === terminal.id)?.status).toBe(expected);
  });
});
