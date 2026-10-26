import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { ProjectPreviewService } from './project-preview.service';

const invoke = vi.fn();

describe('ProjectPreviewService', () => {
  let service: ProjectPreviewService;
  const state = {
    workspaces: () => [{ id: 'w', projectPath: 'D:/项目' }],
    activeWorkspace: () => ({ id: 'w' }),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = { invoke };
    TestBed.configureTestingModule({ providers: [{ provide: AppStateService, useValue: state }] });
    service = TestBed.inject(ProjectPreviewService);
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('reads relative terminal paths against their working directory, preserving requested line/column', async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: 'D:/项目/web/src/main.ts',
      kind: 'text',
      content: 'code',
      mime: 'text/plain',
    });
    await service.openFile('w', 'src/main.ts', 'D:/项目/web', 12, 3);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'read_project_preview',
      {
        workspaceId: 'w',
        path: 'D:/项目/web/src/main.ts',
      },
      undefined,
    );
    expect(service.file()?.path).toBe('D:/项目/web/src/main.ts');
    expect(service.location()).toEqual({ line: 12, column: 3 });
  });

  it('rejects unknown workspaces before any host read', async () => {
    await expect(service.openFile('missing', 'file.txt')).rejects.toThrow('项目不存在');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not replace a newer web preview with an older file response and cancels loading on close', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = service.openFile('w', 'src/old.ts');
    service.openUrl('http://localhost:3000', 'w');
    resolve({ path: 'D:/项目/src/old.ts', kind: 'text', content: 'old', mime: 'text/plain' });
    await pending;
    expect(service.url()).toBe('http://localhost:3000/');
    expect(service.file()).toBeNull();
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const second = service.openFile('w', 'src/new.ts');
    const closed = service.activeTab()!;
    service.close(closed.id);
    expect(closed.loading()).toBe(false);
    finish({ path: 'new.ts', kind: 'text', content: 'new', mime: 'text/plain' });
    await second;
    expect(service.open()).toBe(true);
    expect(service.tabs()).not.toContain(closed);
    expect(closed.file()).toBeNull();
    expect(service.file()).toBeNull();
  });

  it('retains independent files, positions and directories, and reuses only an explicitly targeted tab', async () => {
    invoke.mockResolvedValueOnce({ path: 'D:/项目/one.ts', kind: 'text', content: 'one', mime: 'text/plain' });
    const first = await service.openFile('w', 'one.ts', undefined, 3, 2);
    invoke.mockResolvedValueOnce({ path: 'D:/项目/two.ts', kind: 'text', content: 'two', mime: 'text/plain' });
    const second = await service.openFile('w', 'two.ts');
    expect(service.tabs()).toHaveLength(2);
    expect(first.file()?.content).toBe('one');
    expect(first.location()).toEqual({ line: 3, column: 2 });
    expect(second.file()?.content).toBe('two');
    const activation = service.activation();
    invoke.mockResolvedValueOnce({ path: 'D:/项目/docs', entries: [], truncated: false });
    await first.browse('w', 'docs');
    expect(first.directory()?.path).toBe('D:/项目/docs');
    expect(second.directory()).toBeNull();
    expect(service.activeTab()?.id).toBe(second.id);
    expect(service.activation()).toBe(activation);
    service.openUrl('https://example.com', 'w', first.id);
    expect(service.tabs()).toHaveLength(2);
    expect(service.activeTab()?.id).toBe(first.id);
    expect(second.file()?.content).toBe('two');
    expect(() => service.openUrl('https://example.com', 'w', 'missing')).toThrow('预览标签不存在');
  });

  it('does not change the active tab when another tab is closed', () => {
    const first = service.openUrl('https://example.com', 'w');
    const second = service.openUrl('https://example.org', 'w');
    const activation = service.activation();
    service.close(first.id);
    expect(service.activeTab()?.id).toBe(second.id);
    expect(service.activation()).toBe(activation);
    expect(second.url()).toBe('https://example.org/');
  });

  it('navigates directories from terminal links and surfaces read failures with an external-open path', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      path: 'D:/项目/docs',
      kind: 'directory',
      content: '',
      mime: '',
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      path: 'D:/项目/docs',
      entries: [],
      truncated: false,
    });
    await service.openFile('w', 'docs');
    expect(service.directory()?.path).toBe('D:/项目/docs');
    expect(service.loading()).toBe(false);
    vi.mocked(invoke).mockRejectedValueOnce('文件超过限制');
    await expect(service.openFile('w', 'huge.pdf')).rejects.toBe('文件超过限制');
    expect(service.error()).toContain('文件超过限制');
    expect(service.failedPath()).toBe('huge.pdf');
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([name]) =>
          ['read_project_preview', 'list_project_directory'].includes(name),
        ),
    ).toBe(true);
  });
});
