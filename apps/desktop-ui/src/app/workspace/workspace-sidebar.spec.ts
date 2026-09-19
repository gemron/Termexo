import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Workspace } from '../core/models/workspace.models';
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

    rows[2].querySelector('.workspace-item')!.dispatchEvent(
      new Event('dragstart', { bubbles: true, cancelable: true }),
    );
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
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));

    expect(moved).toEqual([{ workspaceId: 'second', direction: -1 }]);
    root.querySelectorAll<HTMLButtonElement>('.workspace-more')[1].click();
    fixture.detectChanges();
    expect(root.querySelector('.workspace-order-action')).toBeNull();
  });
});
