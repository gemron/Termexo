import { WorkspaceRepository } from './workspace.repository';

describe('WorkspaceRepository', () => {
  const legacyStorageKey = 'agentdock.workspaces.v1';
  const storageKey = 'termexo.workspaces.v1';

  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates legacy browser workspaces when they are first read', async () => {
    const workspaces = [{ id: 'workspace-1', name: 'Existing workspace' }];
    localStorage.setItem(legacyStorageKey, JSON.stringify(workspaces));

    const stored = await new WorkspaceRepository().list();

    expect(stored).toEqual(workspaces);
    expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(workspaces));
    expect(localStorage.getItem(legacyStorageKey)).toBeNull();
  });

  it('clears invalid workspace data from both namespaces', async () => {
    localStorage.setItem(legacyStorageKey, 'not-json');

    const stored = await new WorkspaceRepository().list();

    expect(stored).toEqual([]);
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(localStorage.getItem(legacyStorageKey)).toBeNull();
  });
});
