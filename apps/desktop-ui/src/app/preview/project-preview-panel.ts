import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
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
import { markdownAnchor, renderMarkdown } from './markdown-preview';
import { codeLanguage, highlightCode } from './code-highlight';
import { IconComponent } from '../shared/icon/icon';
import {
  CODE_LINE_HEIGHT,
  findPreviewMatches,
  parsePreviewAddress,
  previewBreadcrumbs,
  previewFilename,
  previewMatchMarkup,
  previewOffset,
  relativePreviewPath,
} from './preview-navigation';

@Component({
  selector: 'app-project-preview-panel',
  imports: [FormsModule, IconComponent],
  templateUrl: './project-preview-panel.html',
  styleUrl: './project-preview-panel.scss',
  host: { '[class.expanded]': 'expanded()', '(keydown)': 'handleKeydown($event)' },
})
export class ProjectPreviewPanelComponent {
  readonly session = input<ProjectPreviewSession | null>(null);
  private readonly previewService = inject(ProjectPreviewService);
  protected get preview() {
    return this.session() ?? this.previewService;
  }
  protected readonly browserId = computed(
    () => `preview-file-browser-${this.session()?.id ?? 'active'}`,
  );
  private readonly sanitizer = inject(DomSanitizer);
  private readonly code = viewChild<ElementRef<HTMLTextAreaElement>>('codeText');
  protected readonly gutter = viewChild<ElementRef<HTMLElement>>('gutter');
  private readonly highlightedCode = viewChild<ElementRef<HTMLElement>>('highlightedCode');
  private readonly searchHighlights = viewChild<ElementRef<HTMLElement>>('searchHighlights');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly lineInput = viewChild<ElementRef<HTMLInputElement>>('lineInput');
  private readonly webFrame = viewChild<ElementRef<HTMLIFrameElement>>('webFrame');
  private readonly markdownDocument = viewChild<ElementRef<HTMLElement>>('markdownDocument');
  protected readonly expanded = signal(false);
  protected readonly address = signal('');
  protected readonly fileFilter = signal('');
  protected readonly findOpen = signal(false);
  protected readonly findQuery = signal('');
  protected readonly matchCase = signal(false);
  protected readonly matchIndex = signal(-1);
  protected readonly lineOpen = signal(false);
  protected readonly lineValue = signal('');
  protected readonly imageActualSize = signal(false);
  protected readonly browserOpen = signal(true);
  protected readonly sourceMode = signal(false);
  protected readonly message = signal('');
  protected readonly frameState = signal('正在加载网页…若空白、拒绝连接或需要登录，请外部打开。');
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
  protected readonly textFile = computed(() =>
    ['text', 'markdown'].includes(this.preview.file()?.kind ?? ''),
  );
  protected readonly filename = computed(() =>
    previewFilename(this.preview.file()?.path ?? this.preview.url()),
  );
  protected readonly displayPath = computed(() =>
    relativePreviewPath(this.preview.file()?.path ?? '', this.preview.root()),
  );
  protected readonly lineCount = computed(
    () => (this.preview.file()?.content ?? '').split('\n').length,
  );
  protected readonly cursor = computed(() =>
    codePosition(this.preview.file()?.content ?? '', this.selection().start),
  );
  protected readonly filteredEntries = computed(() => {
    const query = this.fileFilter().trim().toLocaleLowerCase();
    return (this.preview.directory()?.entries ?? []).filter((entry) =>
      entry.name.toLocaleLowerCase().includes(query),
    );
  });
  protected readonly breadcrumbs = computed(() =>
    previewBreadcrumbs(this.preview.directory()?.path ?? this.preview.root(), this.preview.root()),
  );
  protected readonly searchResults = computed(() =>
    findPreviewMatches(this.preview.file()?.content ?? '', this.findQuery(), this.matchCase()),
  );
  protected readonly searchMarkup = computed(() =>
    previewMatchMarkup(
      this.preview.file()?.content ?? '',
      this.searchResults().matches[this.matchIndex()],
    ),
  );
  private objectUrl = '';

  constructor() {
    let previousDirectory = '';
    effect(() => {
      const path = this.preview.directory()?.path ?? '';
      if (path !== previousDirectory) {
        previousDirectory = path;
        this.fileFilter.set('');
      }
    });
    effect(() => {
      this.address.set(
        this.preview.url() ||
          this.preview.file()?.path ||
          this.preview.failedPath() ||
          this.preview.directory()?.path ||
          '',
      );
    });
    effect(() => {
      this.searchResults();
      this.matchIndex.set(-1);
    });
    effect(() => {
      this.searchInput()?.nativeElement.focus();
    });
    effect(() => {
      this.lineInput()?.nativeElement.focus();
    });
    effect(() => {
      this.searchHighlights();
      const element = this.code()?.nativeElement;
      if (element) this.scrollCode(element);
    });
    effect(() => {
      if (this.preview.url()) {
        this.browserOpen.set(false);
        this.frameState.set('正在加载网页…若空白、拒绝连接或需要登录，请外部打开。');
      }
    });
    let previousFile = '';
    effect(() => {
      const file = this.preview.file();
      if (file && file.path !== previousFile) {
        previousFile = file.path;
        this.sourceMode.set(false);
        this.findOpen.set(false);
        this.findQuery.set('');
        this.lineOpen.set(false);
        this.imageActualSize.set(false);
        if (!untracked(() => this.preview.directory())) this.browserOpen.set(false);
      }
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
      const offset = previewOffset(file.content, location.line, location.column);
      element.setSelectionRange(offset, offset);
      element.scrollTop = Math.max(
        0,
        (codePosition(file.content, offset).line - 3) * CODE_LINE_HEIGHT,
      );
      // Creating a find highlight must not reapply the file's original requested location.
      untracked(() => this.scrollCode(element));
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
      } else {
        const target = parsePreviewAddress(value);
        await this.preview.openFile(
          this.preview.workspaceId(),
          target.path,
          undefined,
          target.line,
          target.column,
        );
      }
    });
  }

  protected async browse(path?: string): Promise<void> {
    this.browserOpen.set(true);
    await this.preview.browse(this.preview.workspaceId(), path);
  }

  protected atRoot(): boolean {
    return (
      !this.preview.directory() ||
      relativePreviewPath(this.preview.directory()!.path, this.preview.root()) === '项目根目录'
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

  protected toggleBrowser(): void {
    if (this.browserOpen()) this.browserOpen.set(false);
    else
      void this.browse(
        this.preview.directory()?.path || this.preview.file()?.path.replace(/[\\/][^\\/]+$/, ''),
      );
  }

  protected async refresh(): Promise<void> {
    if (this.preview.url()) {
      this.frameState.set('正在重新加载网页…');
      const frame = this.webFrame()?.nativeElement;
      if (frame) frame.src = this.preview.url();
      return;
    }
    const file = this.preview.file();
    const path = file?.path || this.preview.failedPath();
    if (path) {
      const location = this.cursor();
      await this.perform(() =>
        this.preview.openFile(
          this.preview.workspaceId(),
          path,
          undefined,
          location.line,
          location.column,
        ),
      );
    } else await this.browse(this.preview.directory()?.path);
  }

  protected async openInNewTab(path?: string): Promise<void> {
    const file = path || this.preview.file()?.path;
    await this.perform(async () => {
      if (file) await this.previewService.openFile(this.preview.workspaceId(), file);
      else if (this.preview.url())
        this.previewService.openUrl(this.preview.url(), this.preview.workspaceId());
    });
  }

  protected toggleFind(): void {
    this.sourceMode.set(true);
    this.findOpen.set(!this.findOpen());
  }

  protected findNext(direction = 1): void {
    const matches = this.searchResults().matches;
    if (!matches.length) return;
    const previous = this.matchIndex();
    const index =
      previous < 0
        ? direction > 0
          ? 0
          : matches.length - 1
        : (previous + direction + matches.length) % matches.length;
    this.matchIndex.set(index);
    const match = matches[index];
    this.selectOffset(match.start, match.end);
  }

  protected handleFindKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    this.findNext(event.shiftKey ? -1 : 1);
  }

  protected goToLine(): void {
    const value = Number(this.lineValue());
    if (!Number.isInteger(value) || value < 1 || value > this.lineCount()) {
      this.message.set(`请输入 1 至 ${this.lineCount()} 之间的行号。`);
      return;
    }
    const element = this.code()?.nativeElement;
    if (!element) return;
    const offset = previewOffset(element.value, value);
    this.selectOffset(offset, offset);
    this.lineOpen.set(false);
    this.message.set('');
    element.focus();
  }

  private selectOffset(start: number, end: number): void {
    const element = this.code()?.nativeElement;
    if (!element) return;
    element.setSelectionRange(start, end);
    element.scrollTop = Math.max(
      0,
      (codePosition(element.value, start).line - 3) * CODE_LINE_HEIGHT,
    );
    element.scrollLeft = 0;
    this.selection.set({ start, end });
    this.scrollCode(element);
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      this.textFile() &&
      ['f', 'g'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.sourceMode.set(true);
      if (event.key.toLowerCase() === 'f') {
        this.findOpen.set(true);
        this.searchInput()?.nativeElement.focus();
      } else {
        this.lineOpen.set(true);
        this.lineInput()?.nativeElement.focus();
      }
    } else if (event.key === 'Escape' && (this.findOpen() || this.lineOpen())) {
      event.preventDefault();
      event.stopPropagation();
      this.findOpen.set(false);
      this.lineOpen.set(false);
      this.code()?.nativeElement.focus();
    }
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
    const match = this.searchHighlights()?.nativeElement.firstElementChild as HTMLElement | null;
    if (match)
      match.style.transform = `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`;
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
    if (href.startsWith('#')) {
      let id: string;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        this.message.set('章节链接格式无效。');
        return;
      }
      // Angular strips user-controlled IDs from innerHTML. Resolve anchors within this document's headings.
      const counts = new Map<string, number>();
      const heading = Array.from(
        this.markdownDocument()?.nativeElement.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ??
          [],
      ).find((item) => {
        const slug = markdownAnchor(item.textContent ?? '');
        const count = counts.get(slug) ?? 0;
        counts.set(slug, count + 1);
        return slug + (count ? '-' + count : '') === id;
      });
      if (heading) heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else this.message.set('未找到此文档章节。');
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      void this.perform(async () => {
        this.preview.openUrl(href, this.preview.workspaceId());
      });
    } else {
      const path = this.preview.file()?.path;
      const directory = path?.replace(/[\\/][^\\/]+$/, '');
      void this.perform(async () => {
        const target = parsePreviewAddress(decodeURIComponent(href));
        await this.preview.openFile(
          this.preview.workspaceId(),
          target.path.split('#')[0],
          directory,
          target.line,
          target.column,
        );
      });
    }
  }

  protected async external(): Promise<void> {
    await this.perform(() => this.preview.external());
  }
}
