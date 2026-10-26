import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

import { writeClipboardText } from '../core/services/clipboard-text';
import {
  codePosition,
  codeReference,
  ProjectPreviewService,
  type ProjectPreviewSession,
} from '../core/services/project-preview.service';
import { renderMarkdown } from './markdown-preview';
import { codeLanguage, highlightCode } from './code-highlight';

@Component({
  selector: 'app-project-preview-panel',
  imports: [FormsModule],
  templateUrl: './project-preview-panel.html',
  styleUrl: './project-preview-panel.scss',
})
export class ProjectPreviewPanelComponent {
  readonly session = input<ProjectPreviewSession | null>(null);
  private readonly previewService = inject(ProjectPreviewService);
  protected get preview() { return this.session() ?? this.previewService; }
  protected readonly browserId = computed(() => `preview-file-browser-${this.session()?.id ?? 'active'}`);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly code = viewChild<ElementRef<HTMLTextAreaElement>>('codeText');
  protected readonly gutter = viewChild<ElementRef<HTMLElement>>('gutter');
  private readonly highlightedCode = viewChild<ElementRef<HTMLElement>>('highlightedCode');
  protected readonly address = signal('');
  protected readonly browserOpen = signal(true);
  protected readonly sourceMode = signal(false);
  protected readonly message = signal('');
  protected readonly frameState = signal(
    '正在加载网页…若空白、拒绝连接或需要登录，请外部打开。',
  );
  protected readonly media = signal('');
  protected readonly mediaFrame = signal<SafeResourceUrl | null>(null);
  protected readonly frame = computed(() =>
    this.preview.url() ? this.sanitizer.bypassSecurityTrustResourceUrl(this.preview.url()) : null,
  );
  protected readonly markdown = computed(() => renderMarkdown(this.preview.file()?.content ?? ''));
  protected readonly language = computed(() => codeLanguage(this.preview.file()?.path ?? ''));
  protected readonly highlighted = computed(() => {
    const file = this.preview.file();
    return highlightCode(file?.path ?? '', file?.content ?? '');
  });
  protected readonly lineNumbers = computed(() =>
    Array.from(
      { length: (this.preview.file()?.content ?? '').split('\n').length },
      (_, i) => i + 1,
    ).join('\n'),
  );
  protected readonly selection = signal({ start: 0, end: 0 });
  protected readonly reference = computed(() =>
    codeReference(
      this.preview.file()?.path ?? '',
      this.preview.file()?.content ?? '',
      this.selection().start,
      this.selection().end,
    ),
  );
  private objectUrl = '';

  constructor() {
    effect(() => {
      if (this.preview.directory()) this.browserOpen.set(true);
    });
    effect(() => {
      if (this.preview.url()) {
        this.browserOpen.set(false);
        this.frameState.set('正在加载网页…若空白、拒绝连接或需要登录，请外部打开。');
      }
    });
    effect(() => {
      const file = this.preview.file();
      this.sourceMode.set(false);
      this.frameState.set('正在加载网页…若空白、拒绝连接或需要登录，请外部打开。');
      this.selection.set({ start: 0, end: 0 });
      this.message.set('');
      this.media.set('');
      this.mediaFrame.set(null);
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = '';
      if (file?.kind === 'image' || file?.kind === 'pdf') {
        const bytes = Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0));
        this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
        this.media.set(this.objectUrl);
        this.mediaFrame.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
      }
    });
    effect(() => {
      const file = this.preview.file();
      const element = this.code()?.nativeElement;
      const location = this.preview.location();
      if (!file || !element) return;
      const lines = file.content.split('\n');
      const line = Math.min(lines.length, location.line);
      const offset =
        lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0) +
        Array.from(lines[line - 1])
          .slice(0, location.column - 1)
          .join('').length;
      element.setSelectionRange(offset, offset);
      element.scrollTop = Math.max(0, (line - 3) * 20);
      this.scrollCode(element);
      this.selection.set({ start: offset, end: offset });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    });
  }

  protected async perform(operation: () => Promise<unknown>): Promise<void> {
    this.message.set('');
    try {
      await operation();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (this.preview.error() !== detail) this.message.set(detail);
    }
  }

  protected async navigate(): Promise<void> {
    const value = this.address().trim();
    if (!value) return;
    await this.perform(async () => {
      if (/^https?:\/\//i.test(value)) {
        this.preview.openUrl(value, this.preview.workspaceId());
        this.browserOpen.set(false);
      } else await this.preview.openFile(this.preview.workspaceId(), value);
    });
  }

  protected async browse(path?: string): Promise<void> {
    this.browserOpen.set(true);
    await this.preview.browse(this.preview.workspaceId(), path);
  }

  protected atRoot(): boolean {
    const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    return (
      !this.preview.directory() ||
      normalize(this.preview.directory()!.path) === normalize(this.preview.root())
    );
  }

  protected parent(): string {
    const path = this.preview.directory()?.path ?? this.preview.root();
    return `${path.replace(/[\\/]$/, '')}/..`;
  }

  protected async open(path: string, directory = false): Promise<void> {
    if (directory) await this.browse(path);
    else await this.perform(() => this.preview.openFile(this.preview.workspaceId(), path));
  }

  protected updateSelection(element: HTMLTextAreaElement): void {
    this.selection.set({ start: element.selectionStart, end: element.selectionEnd });
  }

  protected scrollCode(element: HTMLTextAreaElement): void {
    const gutter = this.gutter()?.nativeElement;
    if (gutter) gutter.scrollTop = element.scrollTop;
    const highlighted = this.highlightedCode()?.nativeElement;
    const tokens = highlighted?.firstElementChild as HTMLElement | null;
    if (tokens) {
      tokens.style.transform = `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`;
    }
  }

  protected async copy(kind: 'path' | 'all' | 'location' | 'quote'): Promise<void> {
    const file = this.preview.file();
    if (!file) return;
    await this.perform(async () => {
      let text = file.path;
      const { start, end } = this.selection();
      if (kind === 'all') text = file.content;
      if (kind === 'location') text = this.reference();
      if (kind === 'quote') {
        let body = file.content.slice(start, end);
        if (start === end) {
          const position = codePosition(file.content, start);
          body = file.content.split('\n')[position.line - 1] ?? '';
          const lineStart = start === 0 ? 0 : file.content.lastIndexOf('\n', start - 1) + 1;
          text = codeReference(file.path, file.content, lineStart, lineStart + body.length);
        } else text = this.reference();
        text += `\n${body}`;
      }
      await writeClipboardText(text);
      this.message.set('已复制。');
    });
  }

  protected markdownLink(event: MouseEvent): void {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (!href) return;
    if (/^https?:\/\//i.test(href)) {
      this.preview.openUrl(href, this.preview.workspaceId());
    } else {
      const path = this.preview.file()?.path;
      const directory = path?.replace(/[\\/][^\\/]+$/, '');
      void this.perform(() => this.preview.openFile(this.preview.workspaceId(), href, directory));
    }
  }

  protected async external(): Promise<void> {
    await this.perform(() => this.preview.external());
  }
}
