import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { AppStateService } from './core/services/app-state.service';
import { ProjectPreviewService } from './core/services/project-preview.service';
import { WorkspaceRepository } from './core/services/workspace.repository';

interface PreviewFlow {
  workspaceView: WritableSignal<'terminal' | 'tasks' | 'git' | 'preview'>;
  workspaceMaximized: WritableSignal<boolean>;
  previewWidth: WritableSignal<number>;
  inspectorWidth: WritableSignal<number>;
  selectTerminal(id: string): void;
  openProjectPreview(): Promise<void>;
  handleWindowKeydown(event: KeyboardEvent): void;
  startSidebarResize(target: 'preview', event: PointerEvent): void;
  resizeSidebar(event: PointerEvent): void;
  stopSidebarResize(): void;
  previewMaxWidth(): number;
}

describe('content preview tab', () => {
  let flow: PreviewFlow;
  let state: AppStateService;
  let preview: ProjectPreviewService;
  beforeEach(async () => {
    localStorage.removeItem('termexo.previewWidth');
    vi.spyOn(App.prototype as unknown as { initialize(): Promise<void> }, 'initialize')
      .mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } }],
    });
    TestBed.overrideComponent(App, { set: { template: '' } });
    await TestBed.compileComponents();
    flow = TestBed.createComponent(App).componentInstance as unknown as PreviewFlow;
    state = TestBed.inject(AppStateService);
    preview = TestBed.inject(ProjectPreviewService);
    await state.createWorkspace('Project', 'D:/project');
    TestBed.tick();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('termexo.previewWidth');
  });

  it('activates explicit opens, keeps multiple tabs, and closes each independently', async () => {
    const workspace = state.activeWorkspace()!;
    const terminal = state.createTerminal({ agentType: 'shell' }, workspace.id)!;
    const first = preview.openUrl('https://example.com', workspace.id);
    TestBed.tick();
    expect(flow.workspaceView()).toBe('preview');
    flow.selectTerminal(terminal.id);
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');
    expect(preview.open()).toBe(true);
    await flow.openProjectPreview();
    TestBed.tick();
    expect(flow.workspaceView()).toBe('preview');
    expect(preview.tabs()).toHaveLength(2);
    expect(first.url()).toBe('https://example.com/');
    expect(preview.activeTab()?.id).not.toBe(first.id);
    flow.selectTerminal(terminal.id);
    const next = preview.openUrl('https://example.com/next', workspace.id);
    TestBed.tick();
    expect(flow.workspaceView()).toBe('preview');
    preview.close(next.id);
    TestBed.tick();
    expect(preview.open()).toBe(true);
    expect(flow.workspaceView()).toBe('preview');
    for (const tab of preview.tabs()) preview.close(tab.id);
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');
    expect(state.activeWorkspace()!.terminals).toHaveLength(1);
  });

  it('keeps terminal focus when a background preview read completes', async () => {
    const workspace = state.activeWorkspace()!;
    const terminal = state.createTerminal({ agentType: 'shell' }, workspace.id)!;
    const tab = preview.createTab(workspace.id);
    TestBed.tick();
    flow.selectTerminal(terminal.id);
    TestBed.tick();
    tab.file.set({ path: 'D:/project/main.ts', content: 'loaded', kind: 'text', mime: 'text/plain' });
    tab.loading.set(false);
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');
    expect(preview.activeTab()?.id).toBe(tab.id);
  });

  it('includes the preview in Ctrl+Tab switching', () => {
    const workspace = state.activeWorkspace()!;
    state.createTerminal({ agentType: 'shell' }, workspace.id);
    const first = preview.openUrl('https://example.com', workspace.id);
    const second = preview.openUrl('https://example.org', workspace.id);
    TestBed.tick();
    flow.handleWindowKeydown(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }));
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');
    flow.handleWindowKeydown(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }));
    TestBed.tick();
    expect(flow.workspaceView()).toBe('preview');
    expect(preview.activeTab()?.id).toBe(first.id);
    flow.handleWindowKeydown(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }));
    TestBed.tick();
    expect(preview.activeTab()?.id).toBe(second.id);
  });

  it('keeps previews in their own workspaces without selecting them when switching terminals', async () => {
    const firstWorkspace = state.activeWorkspace()!;
    const firstTerminal = state.createTerminal({ agentType: 'shell' }, firstWorkspace.id)!;
    const first = preview.openUrl('https://example.com', firstWorkspace.id);
    TestBed.tick();
    flow.selectTerminal(firstTerminal.id);
    await state.createWorkspace('Second', 'D:/second');
    const secondTerminal = state.createTerminal({ agentType: 'shell' })!;
    const second = preview.openUrl('https://example.org');
    TestBed.tick();
    flow.selectTerminal(secondTerminal.id);
    state.selectWorkspace(firstWorkspace.id);
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');
    expect(preview.workspaceTabs().map((tab) => tab.id)).toEqual([first.id]);
    expect(preview.tabs()).toHaveLength(2);
    expect(second.url()).toBe('https://example.org/');
    expect(preview.liveTabs().map((tab) => tab.id)).toEqual([first.id, second.id]);
  });

  it('keeps the user in terminals or tasks when terminal status and workspace data change', () => {
    const workspace = state.activeWorkspace()!;
    const terminal = state.createTerminal({ agentType: 'shell' }, workspace.id)!;
    const background = state.createTerminal({ agentType: 'codex' }, workspace.id)!;
    preview.openUrl('https://example.com', workspace.id);
    TestBed.tick();
    flow.selectTerminal(terminal.id);
    TestBed.tick();

    state.updateTerminalStatus(background.id, 'RUNNING');
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');
    state.renameTerminal(background.id, 'Background Agent');
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');
    state.createTerminal({ agentType: 'shell' }, workspace.id);
    TestBed.tick();
    expect(flow.workspaceView()).toBe('terminal');

    flow.workspaceView.set('tasks');
    state.updateTerminalStatus(background.id, 'COMPLETED');
    TestBed.tick();
    expect(flow.workspaceView()).toBe('tasks');
    expect(preview.open()).toBe(true);
  });

  it('resizes and remembers the preview width separately, including in a maximized workspace', () => {
    flow.workspaceMaximized.set(true);
    flow.previewWidth.set(500);
    const inspectorWidth = flow.inspectorWidth();
    flow.startSidebarResize('preview', { button: 0, clientX: 500, preventDefault: vi.fn() } as unknown as PointerEvent);
    flow.resizeSidebar({ clientX: 650 } as PointerEvent);
    expect(flow.previewWidth()).toBe(650);
    flow.resizeSidebar({ clientX: -1000 } as PointerEvent);
    expect(flow.previewWidth()).toBe(320);
    flow.resizeSidebar({ clientX: 10_000 } as PointerEvent);
    expect(flow.previewWidth()).toBe(flow.previewMaxWidth());
    flow.stopSidebarResize();
    expect(localStorage.getItem('termexo.previewWidth')).toBe(String(flow.previewWidth()));
    expect(flow.inspectorWidth()).toBe(inspectorWidth);
  });
});
