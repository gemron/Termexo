import { Workspace } from '../models/workspace.models';
import { WorkspaceOrganizationService } from './workspace-organization.service';

describe('WorkspaceOrganizationService', () => {
  const storageKey = 'termexo.workspace-organization.v1';

  function workspace(id: string, sortOrder: number): Workspace {
    return {
      id,
      name: `Workspace ${id}`,
      sortOrder,
      projectPath: `D:\\projects\\${id}`,
      projectType: 'Local project',
      activeBranch: 'main',
      favorite: false,
      lastOpenedAt: 0,
      layout: 'single',
      terminals: [],
    };
  }

  beforeEach(() => localStorage.removeItem(storageKey));

  it('adopts older workspaces at the root and supplies empty organization metadata', () => {
    const service = new WorkspaceOrganizationService();
    service.initialize([workspace('one', 0), workspace('two', 1)]);

    expect(service.organization().folders).toEqual([]);
    expect(service.entryFor('one')).toEqual({
      folderId: null,
      tags: [],
      icon: null,
      sortOrder: 0,
    });
    expect(service.entryFor('two').folderId).toBeNull();
  });

  it('persists nested folders, tags, icons, and the selected workspace across initialization', () => {
    const workspaces = [workspace('one', 0)];
    const first = new WorkspaceOrganizationService();
    first.initialize(workspaces);
    const parent = first.createFolder('Projects')!;
    const child = first.createFolder('Research', parent.id)!;
    first.moveWorkspaceToFolder('one', child.id);
    first.toggleFolder(child.id);
    first.updateWorkspace('one', { tags: ['research', 'urgent', 'research'], icon: 'git-branch' });

    const restarted = new WorkspaceOrganizationService();
    restarted.initialize(workspaces);

    expect(restarted.organization().folders).toEqual(first.organization().folders);
    expect(
      restarted.organization().folders.find((folder) => folder.id === child.id)?.collapsed,
    ).toBe(true);
    expect(restarted.entryFor('one')).toMatchObject({
      folderId: child.id,
      tags: ['research', 'urgent'],
      icon: 'git-branch',
    });
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}').version).toBe(1);
  });

  it('reparents a folder’s workspaces and child folders when deleting it', () => {
    const service = new WorkspaceOrganizationService();
    service.initialize([workspace('one', 0), workspace('two', 1)]);
    const parent = service.createFolder('Projects')!;
    const removed = service.createFolder('Old group', parent.id)!;
    const child = service.createFolder('Keep this group', removed.id)!;
    service.moveWorkspaceToFolder('one', removed.id);
    service.moveWorkspaceToFolder('two', child.id);

    expect(service.deleteFolder(removed.id)).toBe(true);
    expect(service.organization().folders.find((folder) => folder.id === child.id)?.parentId).toBe(
      parent.id,
    );
    expect(service.entryFor('one').folderId).toBe(parent.id);
    expect(service.entryFor('two').folderId).toBe(child.id);
  });

  it('moves workspace rows between folders and refuses to create a folder cycle', () => {
    const service = new WorkspaceOrganizationService();
    const workspaces = [workspace('one', 0), workspace('two', 1)];
    service.initialize(workspaces);
    const parent = service.createFolder('Projects')!;
    const child = service.createFolder('Research', parent.id)!;
    service.moveWorkspaceToFolder('one', parent.id);
    service.moveWorkspaceToFolder('two', child.id);

    expect(service.reorderWorkspace('one', 'two', 'after', workspaces)).toBe(true);
    expect(service.entryFor('one').folderId).toBe(child.id);
    expect(service.moveFolder(parent.id, child.id)).toBe(false);
  });

  it('rejects blank and duplicate sibling names while allowing names in different parents', () => {
    const service = new WorkspaceOrganizationService();
    service.initialize([]);
    const projects = service.createFolder(' Projects ')!;
    const research = service.createFolder('Research')!;
    expect(projects.name).toBe('Projects');
    expect(service.createFolder('projects')).toBeNull();
    expect(service.createFolder('  ')).toBeNull();
    expect(service.createFolder('Child', 'missing')).toBeNull();
    expect(service.createFolder('Projects', research.id)).not.toBeNull();
    expect(service.renameFolder(research.id, ' PROJECTS ')).toBe(false);
    expect(service.renameFolder(research.id, ' Experiments ')).toBe(true);
    expect(service.folders().find((folder) => folder.id === research.id)?.name).toBe('Experiments');
  });

  it('opens the parent chain when adding a subfolder or moving a workspace into it', () => {
    const service = new WorkspaceOrganizationService();
    service.initialize([workspace('one', 0)]);
    const parent = service.createFolder('Projects')!;
    const child = service.createFolder('Research', parent.id)!;
    service.toggleFolder(parent.id);
    service.toggleFolder(child.id);
    service.createFolder('New group', child.id);
    expect(service.folders().filter((folder) => folder.collapsed)).toEqual([]);
    service.toggleFolder(parent.id);
    service.toggleFolder(child.id);
    expect(service.moveWorkspaceToFolder('one', child.id)).toBe(true);
    expect(service.folders().filter((folder) => folder.collapsed)).toEqual([]);
    expect(service.moveWorkspaceToFolder('missing', child.id)).toBe(false);
  });

  it('distinguishes nesting siblings from reordering folders across parents', () => {
    const service = new WorkspaceOrganizationService();
    service.initialize([]);
    const first = service.createFolder('First')!;
    const second = service.createFolder('Second')!;
    const nested = service.createFolder('Nested', second.id)!;
    expect(service.moveFolder(first.id, second.id)).toBe(true);
    expect(service.folders().find((folder) => folder.id === first.id)?.parentId).toBe(second.id);
    expect(service.moveFolder(first.id, nested.id, 'before')).toBe(true);
    expect(service.folders().find((folder) => folder.id === first.id)?.sortOrder).toBe(0);
    expect(service.moveFolder(first.id, second.id, 'before')).toBe(true);
    expect(service.folders().find((folder) => folder.id === first.id)).toMatchObject({
      parentId: null,
      sortOrder: 0,
    });
    expect(service.moveFolder(second.id, nested.id)).toBe(false);
    expect(service.moveFolder(second.id, nested.id, 'after')).toBe(false);
  });

  it('appends a folder moved into a destination after its existing contents', () => {
    const service = new WorkspaceOrganizationService();
    service.initialize([workspace('one', 0)]);
    const destination = service.createFolder('Destination')!;
    service.moveWorkspaceToFolder('one', destination.id);
    service.createFolder('Existing', destination.id);
    const moved = service.createFolder('Moved')!;
    service.toggleFolder(destination.id);
    expect(service.moveFolder(moved.id, destination.id)).toBe(true);
    expect(service.folders().find((folder) => folder.id === moved.id)?.sortOrder).toBe(2);
    expect(service.folders().find((folder) => folder.id === destination.id)?.collapsed).toBe(false);
  });

  it('puts an ungrouped folder’s contents at its previous position rather than at the end', () => {
    const service = new WorkspaceOrganizationService();
    const workspaces = [workspace('one', 0), workspace('two', 1), workspace('three', 2)];
    service.initialize(workspaces);
    const group = service.createFolder('Group')!;
    service.moveWorkspaceToFolder('one', group.id);
    service.moveWorkspaceToFolder('two', group.id);
    service.reorderWorkspace('three', 'one', 'after', workspaces);
    const after = service.createFolder('After')!;
    service.moveWorkspaceToFolder('three', after.id);
    // Group precedes After and its two workspaces stay ahead of After's contents.
    expect(service.deleteFolder(group.id)).toBe(true);
    expect(service.orderWorkspaces(workspaces).map((item) => item.id)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(service.entryFor('one').folderId).toBeNull();
    expect(service.entryFor('two').folderId).toBeNull();
  });
});
