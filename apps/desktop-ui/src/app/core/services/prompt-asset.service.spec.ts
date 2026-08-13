import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerminalSession, Workspace } from '../models/workspace.models';
import { PromptAssetService } from './prompt-asset.service';

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Termexo',
  projectPath: 'D:/devlop/Termexo',
  projectType: 'Angular + Rust',
  activeBranch: 'main',
  favorite: false,
  lastOpenedAt: 1,
  layout: 'columns',
  terminals: [],
};
const claude: TerminalSession = {
  id: 'claude-1',
  name: 'Claude 1',
  workingDirectory: workspace.projectPath,
  shell: 'pwsh',
  agentType: 'claude',
  status: 'RUNNING',
  model: 'sonnet',
  branch: 'main',
};
const codex: TerminalSession = { ...claude, id: 'codex-1', name: 'Codex 1', agentType: 'codex' };

describe('PromptAssetService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('isolates live drafts per terminal and commits history on Enter', async () => {
    const service = TestBed.inject(PromptAssetService);
    await service.initialize();

    service.captureInput(workspace, claude, '修复光标');
    service.captureInput(workspace, codex, '继续开发');
    await vi.advanceTimersByTimeAsync(300);

    expect(service.draftForTerminal(claude.id)?.content).toBe('修复光标');
    expect(service.draftForTerminal(codex.id)?.content).toBe('继续开发');

    service.captureInput(workspace, claude, '\r');
    await vi.runAllTimersAsync();

    expect(service.draftForTerminal(claude.id)).toBeUndefined();
    expect(
      service.assets().some((asset) => asset.kind === 'history' && asset.content === '修复光标'),
    ).toBe(true);
    expect(service.draftForTerminal(codex.id)?.content).toBe('继续开发');
  });

  it('recovers the latest unsent draft after the service is recreated', async () => {
    const first = TestBed.inject(PromptAssetService);
    await first.initialize();
    first.captureInput(workspace, claude, '不要丢失这个草稿');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const restored = TestBed.inject(PromptAssetService);
    await restored.initialize();

    expect(restored.draftForTerminal(claude.id)?.content).toBe('不要丢失这个草稿');
  });

  it('never records shell input as a prompt asset', async () => {
    const service = TestBed.inject(PromptAssetService);
    await service.initialize();
    service.captureInput(
      workspace,
      { ...claude, id: 'shell-1', agentType: 'shell' },
      'git status\r',
    );
    await vi.runAllTimersAsync();
    expect(service.assets()).toEqual([]);
  });
});
