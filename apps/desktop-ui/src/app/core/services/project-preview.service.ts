import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';

import { createId } from '../models/identifiers';
import { AppStateService } from './app-state.service';
import { invoke } from './backend-bridge';
import { hasBackend, runtimeMode } from './tauri-runtime';

export interface ProjectEntry {
  name: string;
  path: string;
  directory: boolean;
}
export interface ProjectDirectory {
  path: string;
  entries: ProjectEntry[];
  truncated: boolean;
}
export interface ProjectPreview {
  path: string;
  kind: 'text' | 'markdown' | 'image' | 'pdf' | 'unsupported';
  mime: string;
  content: string;
  message?: string;
}
export interface PreviewLocation {
  line: number;
  column: number;
}

export function previewUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('网页预览仅支持不含登录凭据的 http / https 地址。');
  return url.href;
}

export function codePosition(text: string, offset: number): PreviewLocation {
  const before = text.slice(0, Math.min(text.length, Math.max(0, offset)));
  const lastBreak = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: Array.from(before.slice(lastBreak + 1)).length + 1,
  };
}

export function codeReference(path: string, text: string, start: number, end: number): string {
  const first = codePosition(text, start);
  const last = codePosition(text, end);
  const location = `${path}:${first.line}:${first.column}`;
  return start === end ? location : `${location}-${last.line}:${last.column}`;
}

export class ProjectPreviewSession {
  readonly open = signal(true);
  readonly workspaceId = signal('');
  readonly directory = signal<ProjectDirectory | null>(null);
  readonly file = signal<ProjectPreview | null>(null);
  readonly url = signal('');
  readonly error = signal('');
  readonly failedPath = signal('');
  readonly loading = signal(false);
  readonly listing = signal(false);
  readonly location = signal<PreviewLocation>({ line: 1, column: 1 });
  private generation = 0;
  private directoryGeneration = 0;

  readonly title = computed(() => {
    const path = this.file()?.path;
    if (path) return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || this.label;
    if (this.url()) return new URL(this.url()).host;
    return this.label;
  });

  constructor(
    private readonly state: AppStateService,
    readonly id: string,
    workspaceId: string,
    readonly label: string,
    private readonly onClose: () => void,
  ) {
    this.workspaceId.set(workspaceId);
  }

  root(workspaceId = this.workspaceId()): string {
    const workspace = this.state.workspaces().find((item) => item.id === workspaceId);
    if (!workspace) throw new Error('项目不存在。');
    return workspace.projectPath;
  }

  close(): void { this.onClose(); }

  dispose(): void {
    this.open.set(false);
    this.loading.set(false);
    this.listing.set(false);
    ++this.generation;
    ++this.directoryGeneration;
  }

  async browse(workspaceId: string, path?: string): Promise<void> {
    this.root(workspaceId);
    ++this.generation;
    this.loading.set(false);
    this.failedPath.set('');
    if (this.workspaceId() !== workspaceId) {
      this.file.set(null);
      this.url.set('');
      this.directory.set(null);
      ++this.generation;
    }
    this.workspaceId.set(workspaceId);
    const generation = ++this.directoryGeneration;
    this.listing.set(true);
    this.error.set('');
    try {
      if (!hasBackend()) throw new Error('项目文件读取需要连接桌面应用；浏览器预览可查看网页。');
      const directory = await invoke<ProjectDirectory>('list_project_directory', {
        workspaceId,
        path,
      });
      if (generation === this.directoryGeneration) this.directory.set(directory);
    } catch (error) {
      if (generation === this.directoryGeneration) this.error.set(String(error));
    } finally {
      if (generation === this.directoryGeneration) this.listing.set(false);
    }
  }

  async openFile(
    workspaceId: string,
    path: string,
    workingDirectory?: string,
    line = 1,
    column = 1,
  ): Promise<void> {
    this.root(workspaceId);
    const generation = ++this.generation;
    if (this.workspaceId() !== workspaceId) {
      this.directory.set(null);
      ++this.directoryGeneration;
    }
    this.workspaceId.set(workspaceId);
    this.loading.set(true);
    this.error.set('');
    this.url.set('');
    this.file.set(null);
    const absolute = /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(path);
    const resolved =
      !absolute && workingDirectory ? `${workingDirectory.replace(/[\\/]$/, '')}/${path}` : path;
    this.failedPath.set(resolved);
    this.location.set({ line: Math.max(1, line), column: Math.max(1, column) });
    try {
      if (!hasBackend()) throw new Error('项目文件读取需要连接桌面应用。');
      const file = await invoke<
        Omit<ProjectPreview, 'kind'> & { kind: ProjectPreview['kind'] | 'directory' }
      >('read_project_preview', { workspaceId, path: resolved });
      if (generation !== this.generation) return;
      if (file.kind === 'directory') {
        await this.browse(workspaceId, file.path);
        return;
      }
      this.file.set(file as ProjectPreview);
      this.failedPath.set('');
    } catch (error) {
      if (generation === this.generation) {
        this.error.set(String(error));
        throw error;
      }
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  openUrl(value: string, workspaceId = this.state.activeWorkspace()?.id ?? ''): void {
    const url = previewUrl(value);
    this.root(workspaceId);
    ++this.generation;
    if (this.workspaceId() !== workspaceId) {
      this.directory.set(null);
      ++this.directoryGeneration;
    }
    this.workspaceId.set(workspaceId);
    this.loading.set(false);
    this.url.set(url);
    this.file.set(null);
    this.failedPath.set('');
    this.error.set('');
  }

  async external(): Promise<void> {
    if (this.url()) {
      if (runtimeMode() === 'desktop') await invoke('open_terminal_url', { url: this.url() });
      else window.open(this.url(), '_blank', 'noopener,noreferrer');
    } else {
      if (runtimeMode() !== 'desktop') throw new Error('请在桌面应用中使用外部应用打开文件。');
      await invoke('open_terminal_path', {
        path: this.file()?.path || this.failedPath(),
        workingDirectory: this.root(),
      });
    }
  }
}


/** Each tab owns its reads and view state. Only explicit opens/selections request focus. */
@Injectable({ providedIn: 'root' })
export class ProjectPreviewService {
  private readonly state = inject(AppStateService);
  readonly tabs = signal<ProjectPreviewSession[]>([]);
  readonly activeTabId = signal<string | null>(null);
  readonly activation = signal(0);
  private nextNumber = 1;
  readonly liveTabs = computed(() => {
    const workspaceIds = new Set(this.state.workspaces().map((workspace) => workspace.id));
    return this.tabs().filter((tab) => workspaceIds.has(tab.workspaceId()));
  });
  readonly workspaceTabs = computed(() => {
    const workspaceId = this.state.activeWorkspace()?.id;
    return this.liveTabs().filter((tab) => tab.workspaceId() === workspaceId);
  });
  readonly activeTab = computed(() =>
    this.workspaceTabs().find((tab) => tab.id === this.activeTabId()) ?? this.workspaceTabs().at(-1) ?? null,
  );
  readonly open = computed(() => this.workspaceTabs().length > 0);
  readonly workspaceId = computed(() => this.activeTab()?.workspaceId() ?? '');
  readonly file = computed(() => this.activeTab()?.file() ?? null);
  readonly directory = computed(() => this.activeTab()?.directory() ?? null);
  readonly url = computed(() => this.activeTab()?.url() ?? '');
  readonly error = computed(() => this.activeTab()?.error() ?? '');
  readonly failedPath = computed(() => this.activeTab()?.failedPath() ?? '');
  readonly loading = computed(() => this.activeTab()?.loading() ?? false);
  readonly listing = computed(() => this.activeTab()?.listing() ?? false);
  readonly location = computed(() => this.activeTab()?.location() ?? { line: 1, column: 1 });

  constructor() {
    effect(() => {
      const workspaceIds = new Set(this.state.workspaces().map((workspace) => workspace.id));
      const removed = this.tabs().filter((tab) => !workspaceIds.has(tab.workspaceId()));
      untracked(() => removed.forEach((tab) => this.close(tab.id)));
    });
  }

  root(workspaceId = this.workspaceId()): string {
    const workspace = this.state.workspaces().find((item) => item.id === workspaceId);
    if (!workspace) throw new Error('项目不存在。');
    return workspace.projectPath;
  }

  createTab(workspaceId: string): ProjectPreviewSession {
    this.root(workspaceId);
    const id = createId();
    const tab = new ProjectPreviewSession(this.state, id, workspaceId, `内容预览 ${this.nextNumber++}`, () => this.close(id));
    this.tabs.update((tabs) => [...tabs, tab]);
    this.activate(id);
    return tab;
  }

  activate(tabId = this.activeTab()?.id): void {
    if (!tabId || !this.tabs().some((tab) => tab.id === tabId)) return;
    this.activeTabId.set(tabId);
    this.activation.update((value) => value + 1);
  }

  close(tabId = this.activeTab()?.id): void {
    const tabs = this.tabs();
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    tab.dispose();
    const remaining = tabs.filter((item) => item.id !== tab.id);
    this.tabs.set(remaining);
    if (this.activeTabId() === tab.id) {
      const siblings = remaining.filter((item) => item.workspaceId() === tab.workspaceId());
      this.activeTabId.set(siblings.at(-1)?.id ?? null);
    }
  }

  private target(workspaceId: string, tabId?: string): ProjectPreviewSession {
    if (!tabId) return this.createTab(workspaceId);
    const tab = this.tabs().find((item) => item.id === tabId && item.workspaceId() === workspaceId);
    if (!tab) throw new Error('预览标签不存在，或不属于指定项目。');
    this.activate(tab.id);
    return tab;
  }

  async browse(workspaceId: string, path?: string): Promise<ProjectPreviewSession> {
    const tab = this.createTab(workspaceId);
    await tab.browse(workspaceId, path);
    return tab;
  }

  async openFile(workspaceId: string, path: string, workingDirectory?: string, line = 1, column = 1, tabId?: string): Promise<ProjectPreviewSession> {
    const tab = this.target(workspaceId, tabId);
    await tab.openFile(workspaceId, path, workingDirectory, line, column);
    return tab;
  }

  openUrl(value: string, workspaceId = this.state.activeWorkspace()?.id ?? '', tabId?: string): ProjectPreviewSession {
    const url = previewUrl(value);
    const tab = this.target(workspaceId, tabId);
    tab.openUrl(url, workspaceId);
    return tab;
  }

  async external(): Promise<void> { await this.activeTab()?.external(); }
}
