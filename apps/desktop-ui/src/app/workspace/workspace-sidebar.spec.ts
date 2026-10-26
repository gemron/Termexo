import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../core/i18n/i18n.service';

import { Workspace } from '../core/models/workspace.models';
import { WorkspaceOrganizationData } from '../core/services/workspace-organization.service';
import { WorkspaceSidebarComponent } from './workspace-sidebar';

describe('WorkspaceSidebarComponent', () => {
  let fixture: ComponentFixture<WorkspaceSidebarComponent>;
  let root: HTMLElement;
  const workspaces: Workspace[] = ['first', 'second', 'third'].map((id, sortOrder) => ({
    id,
    name: id,
    sortOrder,
    projectPath: `D:\\dev\\${id}`,
    projectType: 'Local project',
    activeBranch: 'main',
    favorite: false,
    lastOpenedAt: 0,
    layout: 'single',
    terminals: [],
  }));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WorkspaceSidebarComponent] });
    fixture = TestBed.createComponent(WorkspaceSidebarComponent);
    fixture.componentRef.setInput('workspaces', workspaces);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  it('reorders a dragged row without selecting it', () => {
    const reordered: unknown[] = [];
    const selected: string[] = [];
    fixture.componentInstance.reorderRequested.subscribe((value) => reordered.push(value));
    fixture.componentInstance.workspaceSelected.subscribe((value) => selected.push(value));
    const rows = root.querySelectorAll<HTMLElement>('.workspace-entry');
    vi.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({
      top: 100,
      height: 40,
    } as DOMRect);

    rows[2]
      .querySelector('.workspace-item')!
      .dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'clientY', { value: 105 });
    rows[0].dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    fixture.detectChanges();
    expect(rows[0].classList.contains('drop-before')).toBe(true);

    rows[0].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(reordered).toEqual([
      { workspaceId: 'third', targetWorkspaceId: 'first', position: 'before' },
    ]);
    expect(selected).toEqual([]);
    expect(rows[0].classList.contains('drop-before')).toBe(false);
  });

  it('keeps keyboard ordering when the menu no longer has move buttons', () => {
    const moved: unknown[] = [];
    fixture.componentInstance.moveRequested.subscribe((value) => moved.push(value));
    const row = root.querySelectorAll<HTMLElement>('.workspace-item')[1];
    row.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }),
    );

    expect(moved).toEqual([{ workspaceId: 'second', direction: -1 }]);
    root.querySelectorAll<HTMLButtonElement>('.workspace-more')[1].click();
    fixture.detectChanges();
    expect(root.querySelector('.workspace-order-action')).toBeNull();
  });

  function folderOrganization(): WorkspaceOrganizationData {
    return {
      version: 1,
      folders: [
        { id: 'projects', name: 'Projects', parentId: null, sortOrder: 0, collapsed: false },
        { id: 'research', name: 'Research', parentId: 'projects', sortOrder: 0, collapsed: false },
      ],
      workspaces: {},
    };
  }

  it('focuses folder creation, validates sibling names, and emits the selected parent', async () => {
    fixture.componentRef.setInput('organization', folderOrganization());
    fixture.detectChanges();
    root.querySelectorAll<HTMLButtonElement>('.sidebar-tools button')[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = root.querySelector<HTMLInputElement>('.folder-editor input')!;
    expect(document.activeElement).toBe(input);
    input.value = ' projects ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('.folder-editor [type="submit"]')!.disabled).toBe(
      true,
    );
    const parent = root.querySelector<HTMLSelectElement>('.folder-editor select')!;
    parent.value = 'research';
    parent.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    const created: unknown[] = [];
    fixture.componentInstance.folderCreateRequested.subscribe((value) => created.push(value));
    root
      .querySelector<HTMLFormElement>('.folder-editor')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    expect(created).toEqual([{ name: 'projects', parentId: 'research' }]);
    fixture.detectChanges();
    expect(root.querySelector('.folder-editor')).toBeNull();
  });

  it('offers workspace moves through a menu without requiring drag and drop', () => {
    fixture.componentRef.setInput('organization', folderOrganization());
    fixture.detectChanges();
    root.querySelectorAll<HTMLButtonElement>('.workspace-more:not(.folder-more)')[0].click();
    fixture.detectChanges();
    const moved: unknown[] = [];
    fixture.componentInstance.workspaceFolderRequested.subscribe((value) => moved.push(value));
    const select = root.querySelector<HTMLSelectElement>('.workspace-move select')!;
    expect(Array.from(select.options, (option) => option.textContent?.trim())).toEqual([
      TestBed.inject(I18nService).t('workspace.topLevel'),
      'Projects',
      'Projects / Research',
    ]);
    select.value = 'research';
    select.dispatchEvent(new Event('change'));
    expect(moved).toEqual([{ workspaceId: 'first', folderId: 'research' }]);
  });

  it('selects the containing folder when creating a child and the existing parent when moving', () => {
    fixture.componentRef.setInput('organization', folderOrganization());
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.folder-more')!.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.folder-actions .folder-action')!.click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLSelectElement>('.folder-editor select')!.value).toBe('projects');
    root.querySelector<HTMLButtonElement>('.folder-editor [type="button"]')!.click();
    fixture.detectChanges();
    root.querySelectorAll<HTMLButtonElement>('.folder-more')[1].click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLSelectElement>('.folder-actions select')!.value).toBe('projects');
  });

  it('excludes a folder and its descendants from move targets and confirms ungrouping', () => {
    fixture.componentRef.setInput('organization', folderOrganization());
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.folder-more')!.click();
    fixture.detectChanges();
    const select = root.querySelector<HTMLSelectElement>('.folder-actions select')!;
    expect(Array.from(select.options, (option) => option.value)).toEqual(['']);
    const deleted: string[] = [];
    fixture.componentInstance.folderDeleteRequested.subscribe((id) => deleted.push(id));
    root.querySelector<HTMLButtonElement>('.folder-actions .delete')!.click();
    fixture.detectChanges();
    expect(deleted).toEqual([]);
    expect(root.querySelector('.folder-delete-confirm')?.textContent).toContain(
      TestBed.inject(I18nService).t('workspace.deleteFolderHelp'),
    );
    root.querySelector<HTMLButtonElement>('.folder-delete-confirm .btn-error')!.click();
    expect(deleted).toEqual(['projects']);
  });

  it('uses the middle of a folder row for nesting and the edge for ordering', () => {
    fixture.componentRef.setInput('organization', folderOrganization());
    fixture.detectChanges();
    const moved: unknown[] = [];
    fixture.componentInstance.folderMoveRequested.subscribe((value) => moved.push(value));
    const rows = root.querySelectorAll<HTMLElement>('.folder-entry');
    vi.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40 } as DOMRect);
    const dragTo = (clientY: number): void => {
      rows[1]
        .querySelector('.folder-item')!
        .dispatchEvent(new Event('dragstart', { bubbles: true }));
      const over = new Event('dragover', { cancelable: true });
      Object.defineProperty(over, 'clientY', { value: clientY });
      rows[0].dispatchEvent(over);
      rows[0].dispatchEvent(new Event('drop', { cancelable: true }));
    };
    dragTo(120);
    dragTo(102);
    expect(moved).toEqual([
      { folderId: 'research', targetFolderId: 'projects', position: undefined },
      { folderId: 'research', targetFolderId: 'projects', position: 'before' },
    ]);
  });

  it('combines tag and keyword filters while keeping the matched workspace’s folder path', () => {
    const organization: WorkspaceOrganizationData = {
      version: 1,
      folders: [
        { id: 'projects', name: 'Projects', parentId: null, sortOrder: 0, collapsed: false },
        { id: 'research', name: 'Research', parentId: 'projects', sortOrder: 0, collapsed: false },
      ],
      workspaces: {
        first: { folderId: null, tags: ['frontend'], icon: null, sortOrder: 2 },
        second: { folderId: 'projects', tags: [], icon: null, sortOrder: 1 },
        third: { folderId: 'research', tags: ['research'], icon: 'git-branch', sortOrder: 0 },
      },
    };
    fixture.componentRef.setInput('organization', organization);
    fixture.detectChanges();

    root.querySelectorAll<HTMLButtonElement>('.tag-filter')[1].click();
    const search = root.querySelector<HTMLInputElement>('.search-field input')!;
    search.value = 'third';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(
      Array.from(root.querySelectorAll('.folder-item strong'), (node) => node.textContent),
    ).toEqual(['Projects', 'Research']);
    expect(
      Array.from(root.querySelectorAll('.workspace-copy strong'), (node) => node.textContent),
    ).toEqual(['third']);
  });

  it('updates agent status indicators for an inactive workspace', () => {
    const agent: Workspace['terminals'][number] = {
      id: 'agent-1',
      name: 'Claude',
      workingDirectory: 'D:\\dev\\second',
      shell: 'powershell.exe',
      agentType: 'claude',
      status: 'RUNNING',
      model: 'Claude Sonnet',
      branch: 'main',
    };
    const workspace = { ...workspaces[1], terminals: [agent] };
    fixture.componentRef.setInput('workspaces', [workspaces[0], workspace, workspaces[2]]);
    fixture.detectChanges();

    const status = root.querySelector<HTMLElement>('.workspace-agent-status')!;
    expect(status.getAttribute('data-status')).toBe('RUNNING');
    expect(status.getAttribute('title')).toBe('Claude');
    expect(status.querySelector('.agent-label, .status-label')).toBeNull();
    expect(root.querySelector('.workspace-copy small')).toBeNull();

    fixture.componentRef.setInput('workspaces', [
      workspaces[0],
      { ...workspace, terminals: [{ ...agent, status: 'WAITING_APPROVAL' }] },
      workspaces[2],
    ]);
    fixture.detectChanges();
    expect(status.getAttribute('data-status')).toBe('WAITING_APPROVAL');

    fixture.componentRef.setInput('workspaces', [
      workspaces[0],
      { ...workspace, terminals: [{ ...agent, status: 'COMPLETED' }] },
      workspaces[2],
    ]);
    fixture.detectChanges();
    expect(status.getAttribute('data-status')).toBe('COMPLETED');
    expect(status.querySelector('.status-check')).not.toBeNull();
    expect(status.querySelector('.status-dot')).toBeNull();
  });

  it('keeps agent icons in window order and updates a renamed window tooltip', () => {
    const claude: Workspace['terminals'][number] = {
      id: 'claude-1',
      name: 'First window',
      workingDirectory: 'D:\\dev\\second',
      shell: 'powershell.exe',
      agentType: 'claude',
      status: 'IDLE',
      model: 'Claude Sonnet',
      branch: 'main',
    };
    const shell = { ...claude, id: 'shell-1', name: 'Shell window', agentType: 'shell' as const };
    const codex = {
      ...claude,
      id: 'codex-1',
      name: 'Second window',
      agentType: 'codex' as const,
      status: 'THINKING' as const,
    };
    const workspace = { ...workspaces[1], terminals: [claude, shell, codex] };
    fixture.componentRef.setInput('workspaces', [workspaces[0], workspace, workspaces[2]]);
    fixture.detectChanges();

    const indicators = root.querySelectorAll<HTMLElement>('.workspace-agent-status');
    expect(Array.from(indicators, (indicator) => indicator.title)).toEqual([
      'First window',
      'Second window',
    ]);
    expect(Array.from(indicators, (indicator) => indicator.dataset['status'])).toEqual([
      'IDLE',
      'THINKING',
    ]);

    fixture.componentRef.setInput('workspaces', [
      workspaces[0],
      { ...workspace, terminals: [claude, shell, { ...codex, name: 'Renamed window' }] },
      workspaces[2],
    ]);
    fixture.detectChanges();
    expect(indicators[1].title).toBe('Renamed window');
    expect(indicators[1].getAttribute('aria-label')).toContain('Renamed window');
  });
});
