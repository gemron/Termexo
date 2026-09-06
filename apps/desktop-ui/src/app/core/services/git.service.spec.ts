import { beforeEach, describe, expect, it } from 'vitest';

import type { RepositoryTarget } from '../models/git.models';
import { GitService } from './git.service';

function target(terminalId: string, runtimeRevision = 0): RepositoryTarget {
  return { workspaceId: 'workspace-1', terminalId, runtimeRevision };
}

/**
 * The Git view is destroyed whenever the workspace switches to another view, so what the user was
 * reading has to survive here or every return to the view starts over.
 */
describe('GitService view memory', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the selected file while the target stays the same', () => {
    const service = new GitService();
    service.selectTarget(target('terminal-1'));
    service.selectPath('src/app/app.ts');

    // The same target arriving again is what a re-opened view reports.
    expect(service.selectTarget(target('terminal-1'))).toBe(false);
    expect(service.selectedPath()).toBe('src/app/app.ts');
  });

  it('drops the selected file when another terminal becomes the target', () => {
    const service = new GitService();
    service.selectTarget(target('terminal-1'));
    service.selectPath('src/app/app.ts');

    expect(service.selectTarget(target('terminal-2'))).toBe(true);
    expect(service.selectedPath()).toBe('');
  });

  it('restores the diff layout chosen in an earlier session', () => {
    new GitService().setDiffLayout('split');

    expect(new GitService().diffLayout()).toBe('split');
  });

  it('falls back to the unified layout when nothing is stored', () => {
    expect(new GitService().diffLayout()).toBe('unified');
  });
});
