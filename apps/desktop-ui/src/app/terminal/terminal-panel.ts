import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  normalizeTerminalFontSize,
  TerminalSession,
  TerminalStatus,
} from '../core/models/workspace.models';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { IconComponent } from '../shared/icon/icon';
import { TerminalCompositionAnchor } from './terminal-composition-anchor';
import { DEFAULT_TERMINAL_FONT_NAME, terminalFontFamily } from './terminal-font';
import { terminalKeySequence } from './terminal-key-sequences';
import { TerminalResizeCoordinator } from './terminal-resize-coordinator';
import { detectTerminalRuntimeIssue, TerminalRuntimeIssue } from './terminal-runtime-diagnostics';
import { createTerminalTheme } from './terminal-theme';

/** `MouseEvent.button` value for the right button. */
const RIGHT_MOUSE_BUTTON = 2;

@Component({
  selector: 'app-terminal-panel',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './terminal-panel.html',
  styleUrl: './terminal-panel.scss',
})
export class TerminalPanelComponent implements AfterViewInit {
  private readonly gateway = inject(TerminalGatewayService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('terminal');
  private readonly terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: terminalFontFamily(DEFAULT_TERMINAL_FONT_NAME),
    fontSize: 12,
    lineHeight: 1.35,
    scrollback: 10_000,
    scrollOnUserInput: true,
    smoothScrollDuration: 0,
    minimumContrastRatio: 4.5,
    allowTransparency: true,
    theme: createTerminalTheme(undefined),
  });
  private readonly fitAddon = new FitAddon();
  private readonly resizeCoordinator = new TerminalResizeCoordinator(
    ({ cols, rows }) => this.gateway.resize(this.session().id, cols, rows),
    (error) => {
      if (!this.destroyRef.destroyed) {
        console.warn('Terminal resize failed', {
          terminalId: this.session().id,
          error: this.errorMessage(error),
        });
      }
    },
  );
  private resizeObserver?: ResizeObserver;
  private fitFrame?: number;
  private stabilizationFrame?: number;
  private activationFrame?: number;
  private compositionAnchor?: TerminalCompositionAnchor;
  private runtimeReady = false;
  private viewReady = false;
  private outputTail = '';
  private lastRuntimeIssue: TerminalRuntimeIssue = null;

  readonly session = input.required<TerminalSession>();
  readonly active = input(false);
  readonly visible = input(true);
  readonly maximized = input(false);
  readonly layoutRevision = input(0);
  readonly fontSize = input(12);
  readonly fontName = input(DEFAULT_TERMINAL_FONT_NAME);
  readonly themeColor = input<string>();
  readonly selected = output<string>();
  readonly closeRequested = output<string>();
  readonly maximizeRequested = output<string>();
  readonly statusChanged = output<{ terminalId: string; status: TerminalStatus }>();
  readonly renameRequested = output<{ terminalId: string; name: string }>();
  readonly modelSwitchRequested = output<string>();

  protected readonly renaming = signal(false);

  protected startRename(): void {
    this.renaming.set(true);
    // The input only exists after this render, so focusing waits for it to be in the DOM.
    setTimeout(() => {
      const input = this.container()
        .nativeElement.closest('.terminal-panel')
        ?.querySelector<HTMLInputElement>('.terminal-rename');
      input?.focus();
      input?.select();
    });
  }

  /** Applies a rename, ignoring an empty name or one that did not change. */
  protected commitRename(value: string): void {
    if (!this.renaming()) {
      return;
    }
    this.renaming.set(false);
    const name = value.trim();
    if (name && name !== this.session().name) {
      this.renameRequested.emit({ terminalId: this.session().id, name });
    }
  }

  private readonly runtimeIssue = signal<TerminalRuntimeIssue>(null);
  protected readonly runtimeNotice = computed(() => {
    const issue = this.runtimeIssue();
    return issue
      ? this.i18n.t(issue === 'rate-limit' ? 'terminal.rateLimited' : 'terminal.timeout')
      : null;
  });

  constructor() {
    effect(() => {
      this.terminal.options.fontSize = normalizeTerminalFontSize(this.fontSize());
      if (this.viewReady && this.visible()) {
        this.scheduleFit();
      }
    });
    effect(() => {
      this.terminal.options.fontFamily = terminalFontFamily(this.fontName());
      if (this.viewReady && this.visible()) {
        this.scheduleFit();
      }
    });
    effect(() => {
      this.terminal.options.theme = createTerminalTheme(this.themeColor());
      if (this.viewReady && this.visible()) {
        this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
      }
    });
    effect(() => {
      const shouldActivate = this.active() && this.visible();
      if (this.viewReady && shouldActivate) {
        this.scheduleActivation();
      }
    });
    effect(() => {
      this.layoutRevision();
      if (this.viewReady && this.visible()) {
        this.scheduleFit();
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.terminal.attachCustomKeyEventHandler(this.handleCustomKey);
    this.terminal.loadAddon(this.fitAddon);
    const terminalContainer = this.container().nativeElement;
    this.terminal.open(terminalContainer);
    this.compositionAnchor = new TerminalCompositionAnchor(terminalContainer, () => {
      const cursor = this.terminal.buffer.active;
      return {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        cursorX: cursor.cursorX,
        cursorY: cursor.cursorY,
      };
    });
    terminalContainer.addEventListener('wheel', this.prepareWheelInteraction, {
      capture: true,
      passive: true,
    });
    terminalContainer.addEventListener('wheel', this.stopWheelPropagation, { passive: true });
    terminalContainer.addEventListener('mousedown', this.suppressRightButtonReport, true);
    terminalContainer.addEventListener('contextmenu', this.handleContextMenu);
    terminalContainer.addEventListener('compositionstart', this.prepareComposition, true);
    terminalContainer.addEventListener('compositionstart', this.beginComposition);
    terminalContainer.addEventListener('compositionupdate', this.restoreComposition);
    terminalContainer.addEventListener('compositionend', this.endComposition);
    terminalContainer.addEventListener('focusin', this.prepareComposition);
    terminalContainer.addEventListener('focusout', this.endComposition);
    this.fitTerminal();
    this.scheduleFit();
    if (this.active() && this.visible()) {
      this.scheduleActivation();
    }

    void this.initializeRuntime();
    const inputDisposable = this.terminal.onData((data) => {
      if (data.includes('\r')) {
        this.terminal.scrollToBottom();
        this.runtimeIssue.set(null);
        this.lastRuntimeIssue = null;
        this.outputTail = '';
        this.statusChanged.emit({
          terminalId: this.session().id,
          status: this.session().agentType === 'shell' ? 'RUNNING' : 'THINKING',
        });
      }
      void this.gateway.write(this.session(), data);
    });
    // xterm repositions its IME elements on every render. Registering after open means this runs
    // after xterm's own render listener and restores the caret captured at compositionstart.
    const renderDisposable = this.terminal.onRender(this.restoreComposition);

    this.resizeObserver = new ResizeObserver(() => this.scheduleFit(false));
    this.resizeObserver.observe(terminalContainer);

    this.destroyRef.onDestroy(() => {
      inputDisposable.dispose();
      renderDisposable.dispose();
      this.resizeObserver?.disconnect();
      terminalContainer.removeEventListener('mousedown', this.suppressRightButtonReport, true);
      terminalContainer.removeEventListener('contextmenu', this.handleContextMenu);
      terminalContainer.removeEventListener('compositionstart', this.prepareComposition, true);
      terminalContainer.removeEventListener('compositionstart', this.beginComposition);
      terminalContainer.removeEventListener('compositionupdate', this.restoreComposition);
      terminalContainer.removeEventListener('compositionend', this.endComposition);
      terminalContainer.removeEventListener('focusin', this.prepareComposition);
      terminalContainer.removeEventListener('focusout', this.endComposition);
      terminalContainer.removeEventListener('wheel', this.prepareWheelInteraction, true);
      terminalContainer.removeEventListener('wheel', this.stopWheelPropagation);
      this.resizeCoordinator.dispose();
      if (this.fitFrame !== undefined) {
        window.cancelAnimationFrame(this.fitFrame);
      }
      if (this.stabilizationFrame !== undefined) {
        window.cancelAnimationFrame(this.stabilizationFrame);
      }
      if (this.activationFrame !== undefined) {
        window.cancelAnimationFrame(this.activationFrame);
      }
      this.terminal.dispose();
    });
  }

  focus(): void {
    this.activateTerminal();
  }

  protected dismissRuntimeNotice(): void {
    this.runtimeIssue.set(null);
  }

  protected statusLabel(status: TerminalStatus): string {
    const keys: Record<TerminalStatus, string> = {
      STARTING: 'status.starting',
      RUNNING: 'status.running',
      THINKING: 'status.thinking',
      WAITING_INPUT: 'status.waitingInput',
      WAITING_APPROVAL: 'status.waitingApproval',
      RATE_LIMITED: 'status.rateLimited',
      IDLE: 'status.idle',
      COMPLETED: 'status.completed',
      FAILED: 'status.failed',
      STOPPED: 'status.stopped',
      DISCONNECTED: 'status.disconnected',
    };
    return this.i18n.t(keys[status]);
  }

  private async initializeRuntime(): Promise<void> {
    let unlisten: (() => void) | undefined;
    try {
      const session = this.session();
      unlisten = await this.gateway.connect(session.id, session.runtimeRevision ?? 0, (data) =>
        this.handleOutput(data),
      );
      if (this.destroyRef.destroyed) {
        unlisten();
        unlisten = undefined;
        return;
      }
      this.destroyRef.onDestroy(() => {
        unlisten?.();
        unlisten = undefined;
      });

      if (this.session().agentType === 'codex' && this.session().command) {
        this.terminal.writeln(
          `\u001b[38;2;150;157;164m${this.i18n.t('terminal.codexStarting')}\u001b[0m`,
        );
      }
      await this.gateway.start(
        this.session(),
        Math.max(this.terminal.cols, 20),
        Math.max(this.terminal.rows, 5),
      );
      this.runtimeReady = true;
      this.statusChanged.emit({ terminalId: this.session().id, status: 'RUNNING' });
      this.fitTerminal();
    } catch (error) {
      unlisten?.();
      unlisten = undefined;
      this.statusChanged.emit({ terminalId: this.session().id, status: 'FAILED' });
      this.terminal.writeln(
        `\u001b[38;2;224;108;117m${this.i18n.t('terminal.startFailed', { error: this.errorMessage(error) })}\u001b[0m`,
      );
    }
  }

  private fitTerminal(): void {
    if (!this.visible()) {
      return;
    }
    try {
      this.fitAddon.fit();
      if (this.terminal.rows > 0) {
        this.terminal.refresh(0, this.terminal.rows - 1);
      }
      if (this.runtimeReady) {
        this.resizeCoordinator.schedule({
          cols: this.terminal.cols,
          rows: this.terminal.rows,
        });
      }
    } catch {
      // The container may be temporarily hidden while the layout is changing.
    }
  }

  private scheduleFit(stabilize = true): void {
    if (this.fitFrame !== undefined) {
      window.cancelAnimationFrame(this.fitFrame);
    }
    this.fitFrame = window.requestAnimationFrame(() => {
      this.fitFrame = undefined;
      if (this.destroyRef.destroyed || !this.visible()) {
        return;
      }
      this.fitTerminal();
      if (stabilize) {
        if (this.stabilizationFrame !== undefined) {
          window.cancelAnimationFrame(this.stabilizationFrame);
        }
        this.stabilizationFrame = window.requestAnimationFrame(() => {
          this.stabilizationFrame = undefined;
          if (!this.destroyRef.destroyed && this.visible()) {
            this.fitTerminal();
          }
        });
      }
    });
  }

  private readonly stopWheelPropagation = (event: WheelEvent): void => {
    event.stopPropagation();
  };

  private readonly prepareWheelInteraction = (): void => {
    this.activateTerminal();
  };

  /**
   * Writes sequences xterm does not produce, then stops it from handling the event.
   *
   * Returning false also prevents the browser from treating Shift+Tab as focus navigation,
   * which would move focus out of the terminal entirely.
   */
  private readonly handleCustomKey = (event: KeyboardEvent): boolean => {
    const sequence = terminalKeySequence(event);
    if (!sequence) {
      return true;
    }
    event.preventDefault();
    void this.gateway.write(this.session(), sequence);
    return false;
  };

  private readonly prepareComposition = (): void => this.compositionAnchor?.prepare();

  private readonly beginComposition = (): void => this.compositionAnchor?.begin();

  private readonly restoreComposition = (): void => this.compositionAnchor?.restore();

  private readonly endComposition = (): void => this.compositionAnchor?.end();

  /**
   * Keeps the right button away from xterm so this component alone acts on it.
   *
   * Agents that switch on mouse reporting — Claude Code sends `?1000h` — otherwise receive the
   * click through xterm and paste the clipboard themselves, landing the text a second time next
   * to {@link handleContextMenu}. Capturing above xterm stops the press before it is encoded, and
   * xterm only reports the release of a press it handled, so this covers the whole gesture.
   * Activating here stands in for the focus xterm would have taken on the same event.
   */
  private readonly suppressRightButtonReport = (event: MouseEvent): void => {
    if (event.button !== RIGHT_MOUSE_BUTTON) {
      return;
    }
    // Preventing the default and focusing is the pair xterm applied before it was cut out of the
    // gesture; keeping it stops the browser from starting a selection of its own.
    event.preventDefault();
    event.stopPropagation();
    this.activateTerminal();
  };

  /**
   * Handles right-click as copy-or-paste, the convention terminals on Windows follow.
   *
   * The native WebView2 menu is suppressed: letting it paste as well delivers the text twice,
   * once through the menu and once through this handler.
   */
  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const selection = this.terminal.getSelection();
    if (selection) {
      void navigator.clipboard.writeText(selection).catch(() => undefined);
      this.terminal.clearSelection();
      return;
    }
    void this.pasteFromClipboard();
  };

  /**
   * Writes clipboard text straight to the PTY.
   *
   * `terminal.paste()` would echo the text locally as well as sending it, so the agent would
   * see it once and the screen would show it twice.
   */
  private async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        await this.gateway.write(this.session(), text);
      }
    } catch {
      // Clipboard access can be denied; typing still works, so this stays silent.
    }
  }

  private scheduleActivation(): void {
    if (this.activationFrame !== undefined) {
      window.cancelAnimationFrame(this.activationFrame);
    }
    this.activationFrame = window.requestAnimationFrame(() => {
      this.activationFrame = undefined;
      if (this.destroyRef.destroyed || !this.active() || !this.visible()) {
        return;
      }
      this.fitTerminal();
      this.terminal.focus();
    });
  }

  private activateTerminal(): void {
    if (this.destroyRef.destroyed || !this.visible()) {
      return;
    }
    if (!this.active()) {
      this.selected.emit(this.session().id);
    }
    this.terminal.focus();
  }

  private handleOutput(data: string): void {
    this.terminal.write(data);
    this.outputTail = `${this.outputTail}${data}`.slice(-2_000);
    const issue = detectTerminalRuntimeIssue(this.outputTail);
    if (!issue || issue === this.lastRuntimeIssue) {
      return;
    }
    this.lastRuntimeIssue = issue;
    if (issue === 'rate-limit') {
      this.runtimeIssue.set('rate-limit');
      this.statusChanged.emit({ terminalId: this.session().id, status: 'RATE_LIMITED' });
      return;
    }
    this.runtimeIssue.set('timeout');
    this.statusChanged.emit({ terminalId: this.session().id, status: 'WAITING_INPUT' });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
