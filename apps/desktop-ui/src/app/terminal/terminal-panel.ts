import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  NgZone,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import type { WebglAddon } from '@xterm/addon-webgl';
import type { ILink } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  normalizeTerminalFontSize,
  TerminalSession,
  TerminalStatus,
} from '../core/models/workspace.models';
import { PtyBackendService } from '../core/services/pty-backend.service';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { IconComponent } from '../shared/icon/icon';
import { TerminalCompositionAnchor } from './terminal-composition-anchor';
import { DEFAULT_TERMINAL_FONT_NAME, terminalFontFamily } from './terminal-font';
import { terminalKeySequence, workbenchShortcut } from './terminal-key-sequences';
import {
  detectTerminalLinks,
  readLogicalLine,
  TerminalCell,
  TerminalLineText,
  TerminalLink,
  TerminalRow,
} from './terminal-links';
import { TerminalReplayGate } from './terminal-replay-gate';
import { TerminalResizeCoordinator } from './terminal-resize-coordinator';
import { detectTerminalRuntimeIssue, TerminalRuntimeIssue } from './terminal-runtime-diagnostics';
import {
  cursorScrollSequence,
  ScrollRowAccumulator,
  TerminalScrollRoute,
  terminalScrollRoute,
  wheelScrollRows,
} from './terminal-scroll-route';
import { createTerminalTheme } from './terminal-theme';
import { decayInertia, TerminalTouchScroller } from './terminal-touch-scroll';

/** `MouseEvent.button` value for the right button. */
const RIGHT_MOUSE_BUTTON = 2;

/**
 * Row spacing, as a multiple of the font's own line height.
 *
 * 1 is what the Windows console draws, so the same command reads identically inside Termexo and
 * in a native terminal. Anything above it visibly loosens dense output such as diffs and logs.
 */
const TERMINAL_LINE_HEIGHT = 1;

@Component({
  selector: 'app-terminal-panel',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './terminal-panel.html',
  styleUrl: './terminal-panel.scss',
})
export class TerminalPanelComponent implements AfterViewInit {
  private readonly gateway = inject(TerminalGatewayService);
  private readonly ptyBackend = inject(PtyBackendService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('terminal');
  private readonly terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: terminalFontFamily(DEFAULT_TERMINAL_FONT_NAME),
    fontSize: 12,
    lineHeight: TERMINAL_LINE_HEIGHT,
    scrollback: 10_000,
    scrollOnUserInput: true,
    smoothScrollDuration: 0,
    minimumContrastRatio: 4.5,
    allowTransparency: true,
    theme: createTerminalTheme(undefined),
  });
  private readonly fitAddon = new FitAddon();
  /** Absent whenever the GPU renderer is unavailable or its context was lost. */
  private webglAddon?: WebglAddon;
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
  /** Set when output reaches this view while it is off screen and cannot draw it properly. */
  private wroteWhileHidden = false;
  private outputTail = '';
  private lastRuntimeIssue: TerminalRuntimeIssue = null;
  private readonly replayGate = new TerminalReplayGate();
  /**
   * Whether Ctrl is down, which is the whole gate on link detection.
   *
   * Underlining every path an agent mentions would make ordinary output look clickable and put a
   * link under every stray click. Offering them only while the modifier is held is what a code
   * editor does, and it leaves plain clicking to selection.
   */
  private ctrlHeld = false;
  private readonly touchScroller = new TerminalTouchScroller(() => this.rowHeight());
  /** Carries the fraction of a row a wheel event left over, so a trackpad still scrolls. */
  private readonly wheelRows = new ScrollRowAccumulator();
  private inertiaFrame?: number;
  private inertiaVelocity = 0;
  private inertiaAt = 0;
  /**
   * Where the finger last was, carried into the synthetic wheel events.
   *
   * An agent that tracks the mouse receives the wheel as a mouse report carrying cell coordinates,
   * and a multi-pane TUI such as OpenCode scrolls the pane under them. Reporting the top-left cell
   * would scroll whichever pane happens to sit there instead of the one being dragged.
   */
  private touchPoint = { x: 0, y: 0 };

  readonly session = input.required<TerminalSession>();
  /** Needed when reconnecting, to rebuild the workspace's proxy settings. */
  readonly workspaceId = input('');
  readonly active = input(false);
  readonly visible = input(true);
  readonly maximized = input(false);
  /** Name of the signed-in account this terminal runs on; empty for agents without one. */
  readonly accountName = input('');
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
  readonly accountSwitchRequested = output<string>();
  readonly inputCaptured = output<{ terminalId: string; data: string }>();
  readonly outputCaptured = output<{ terminalId: string; data: string }>();
  /** A link that could not be opened, which the shell reports without touching the buffer. */
  readonly openFailed = output<string>();

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
      const backend = this.ptyBackend.backend();
      if (backend) {
        // Without this xterm assumes it owns reflow. An old system ConPTY rewrites wrapped lines
        // itself, and a second reflow on top of that corrupts them; xterm suppresses its own once
        // it knows the build it is talking to.
        this.terminal.options.windowsPty = {
          backend: backend.backend,
          buildNumber: backend.buildNumber,
        };
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
      // Switching to a panel that received output while it was hidden: it is showing a screen laid
      // out for a grid it never had, so it takes its own grid and is drawn again from the backend.
      if (this.viewReady && this.visible() && this.wroteWhileHidden) {
        this.wroteWhileHidden = false;
        void this.redrawForOwnGrid();
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
    this.terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) =>
        callback(this.ctrlHeld ? this.linksOnLine(bufferLineNumber) : undefined),
    });
    this.terminal.attachCustomWheelEventHandler(this.handleCustomWheel);
    this.terminal.loadAddon(this.fitAddon);
    const terminalContainer = this.container().nativeElement;
    // Outside Angular on purpose: xterm registers its own keyboard, IME and animation-frame
    // listeners here, and inside the zone every keystroke and every rendered frame would run
    // change detection across the whole workbench. The callbacks that do move the UI come back in
    // through `zone.run`.
    this.zone.runOutsideAngular(() => {
      this.terminal.open(terminalContainer);
      void this.enableGpuRenderer();
    });
    this.compositionAnchor = new TerminalCompositionAnchor(terminalContainer, () => {
      const buffer = this.terminal.buffer.active;
      return {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        cursorX: buffer.cursorX,
        cursorY: buffer.cursorY,
        baseY: buffer.baseY,
        viewportY: buffer.viewportY,
      };
    });
    terminalContainer.addEventListener('wheel', this.prepareWheelInteraction, {
      capture: true,
      passive: true,
    });
    terminalContainer.addEventListener('wheel', this.stopWheelPropagation, { passive: true });
    // Not passive: a drag that scrolls the buffer must stop the page from panning as well.
    terminalContainer.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    terminalContainer.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    terminalContainer.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    terminalContainer.addEventListener('touchcancel', this.handleTouchCancel, { passive: true });
    window.addEventListener('keydown', this.trackModifier);
    window.addEventListener('keyup', this.trackModifier);
    window.addEventListener('blur', this.releaseModifier);
    terminalContainer.addEventListener('mousedown', this.suppressRightButtonReport, true);
    terminalContainer.addEventListener('contextmenu', this.handleContextMenu);
    terminalContainer.addEventListener('compositionstart', this.prepareComposition, true);
    terminalContainer.addEventListener('compositionstart', this.beginComposition);
    terminalContainer.addEventListener('compositionupdate', this.restoreCompositionAfterUpdate);
    terminalContainer.addEventListener('compositionend', this.endComposition);
    terminalContainer.addEventListener('focusin', this.prepareComposition);
    terminalContainer.addEventListener('focusin', this.claimOnFocus);
    // Focus alone misses the case where this view never lost it — returning to a window that was
    // already focused fires nothing — so any press in the terminal claims it too.
    terminalContainer.addEventListener('pointerdown', this.claimOnFocus, { passive: true });
    terminalContainer.addEventListener('focusout', this.endComposition);
    this.fitTerminal();
    this.scheduleFit();
    if (this.active() && this.visible()) {
      this.scheduleActivation();
    }

    void this.initializeRuntime();
    const inputDisposable = this.terminal.onData((data) => {
      // History being redrawn, not the user typing: xterm is answering a query the replayed
      // scrollback still carried, and sending that answer would type it into the program.
      if (this.replayGate.replaying) {
        return;
      }
      this.inputCaptured.emit({ terminalId: this.session().id, data });
      if (data.includes('\r')) {
        this.terminal.scrollToBottom();
        this.lastRuntimeIssue = null;
        this.outputTail = '';
        // Submitting a prompt clears the runtime notice and moves the terminal's status, both of
        // which the workbench draws, so this part re-enters the zone.
        this.zone.run(() => {
          this.runtimeIssue.set(null);
          this.statusChanged.emit({
            terminalId: this.session().id,
            status: this.session().agentType === 'shell' ? 'RUNNING' : 'THINKING',
          });
        });
      }
      void this.gateway.write(this.session(), data);
    });
    // xterm repositions its IME elements on every render. Registering after open means this runs
    // after xterm's own render listener, so it wins for both the caret captured at
    // compositionstart and the live cursor the next composition will start from.
    const renderDisposable = this.terminal.onRender(this.syncCompositionAfterRender);

    this.resizeObserver = new ResizeObserver(() => this.scheduleFit(false));
    this.resizeObserver.observe(terminalContainer);

    this.destroyRef.onDestroy(() => {
      inputDisposable.dispose();
      renderDisposable.dispose();
      this.resizeObserver?.disconnect();
      terminalContainer.removeEventListener('mousedown', this.suppressRightButtonReport, true);
      window.removeEventListener('keydown', this.trackModifier);
      window.removeEventListener('keyup', this.trackModifier);
      window.removeEventListener('blur', this.releaseModifier);
      terminalContainer.removeEventListener('contextmenu', this.handleContextMenu);
      terminalContainer.removeEventListener('compositionstart', this.prepareComposition, true);
      terminalContainer.removeEventListener('compositionstart', this.beginComposition);
      terminalContainer.removeEventListener(
        'compositionupdate',
        this.restoreCompositionAfterUpdate,
      );
      terminalContainer.removeEventListener('compositionend', this.endComposition);
      terminalContainer.removeEventListener('focusin', this.prepareComposition);
      terminalContainer.removeEventListener('focusin', this.claimOnFocus);
      terminalContainer.removeEventListener('pointerdown', this.claimOnFocus);
      terminalContainer.removeEventListener('focusout', this.endComposition);
      terminalContainer.removeEventListener('wheel', this.prepareWheelInteraction, true);
      terminalContainer.removeEventListener('wheel', this.stopWheelPropagation);
      terminalContainer.removeEventListener('touchstart', this.handleTouchStart);
      terminalContainer.removeEventListener('touchmove', this.handleTouchMove);
      terminalContainer.removeEventListener('touchend', this.handleTouchEnd);
      terminalContainer.removeEventListener('touchcancel', this.handleTouchCancel);
      this.stopInertia();
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
      this.compositionAnchor?.end();
      // Released before the terminal so the GPU context goes back to the pool right away; a
      // workspace can hold many terminals and the browser caps how many contexts exist at once.
      this.webglAddon?.dispose();
      this.webglAddon = undefined;
      this.terminal.dispose();
    });
  }

  /**
   * Draws the grid on the GPU instead of as DOM nodes.
   *
   * The DOM renderer rebuilds a row of elements per repaint, which is what makes scrolling a long
   * scrollback stutter. The addon is imported on demand so its shaders stay out of the initial
   * bundle — the terminal renders through the DOM until it arrives, a frame or two later.
   *
   * Loading is best-effort: a machine without a usable GPU, or a lost context after too many
   * terminals, keeps the DOM renderer, which draws the same output and only costs speed.
   */
  private async enableGpuRenderer(): Promise<void> {
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      if (this.destroyRef.destroyed) {
        return;
      }
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        this.webglAddon = undefined;
      });
      this.terminal.loadAddon(addon);
      this.webglAddon = addon;
    } catch {
      // Keeps the DOM renderer; nothing about the terminal's behaviour changes.
    }
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
      unlisten = await this.gateway.connect(
        session.id,
        session.runtimeRevision ?? 0,
        (data, replayed) => this.handleOutput(data, replayed),
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

      // The PTY is shared, so its size is negotiated across every attached client; the emulator
      // follows that rather than its own fit, or it would keep drawing columns the agent has
      // stopped refreshing.
      const stopResizeUpdates = await this.gateway.onResized((event) => {
        if (event.terminalId !== this.session().id) {
          return;
        }
        // Only the backend re-lays its screen out for the new grid; xterm would rewrap the frames
        // it holds into something the agent never drew. Once the grid has moved, what is on screen
        // is stale by definition, so it is drawn again from the side that knows the new layout.
        if (this.applyDimensions(event.cols, event.rows) && this.runtimeReady) {
          void this.gateway.redraw(this.session().id);
        }
      });
      if (this.destroyRef.destroyed) {
        stopResizeUpdates();
        return;
      }
      this.destroyRef.onDestroy(() => stopResizeUpdates());

      if (this.session().agentType === 'codex' && this.session().command) {
        this.terminal.writeln(
          `\u001b[38;2;150;157;164m${this.i18n.t('terminal.codexStarting')}\u001b[0m`,
        );
      }
      const { attached, cols, rows } = await this.gateway.start(
        this.session(),
        Math.max(this.terminal.cols, 20),
        Math.max(this.terminal.rows, 5),
        this.workspaceId() || undefined,
      );
      this.runtimeReady = true;
      // The PTY runs at one grid, set by the desktop window. A client whose own window differs —
      // a phone, or the desktop joining a terminal a phone started — has to draw that grid rather
      // than its own, or the agent's redraws would land on the wrong columns.
      this.applyDimensions(cols, rows);
      // A view the user is working in takes the grid the moment it is focused, and focusing a
      // window it has just opened is the ordinary case. Letting that happen after the history is
      // written resizes the emulator underneath a screen an agent drew for the grid before it,
      // and what xterm makes of that — a frame rewrapped or clipped, with the agent's next redraw
      // painted over the remains — is precisely the mangled terminal a focused browser came back
      // to, while one left in the background stayed clean. Taking the grid first leaves nothing
      // written for a grid this view is about to leave behind.
      if (this.active() && this.visible()) {
        await this.claimTerminalSize();
      }
      // Only now, with the grid settled, is history worth writing.
      await this.gateway.replayInitial(this.session().id);
      // Attaching to a PTY that was already running must not discard the state hook events have
      // derived for it; only a fresh launch, or one still marked as starting, becomes RUNNING.
      if (!attached || this.session().status === 'STARTING') {
        this.statusChanged.emit({ terminalId: this.session().id, status: 'RUNNING' });
      }
      this.fitTerminal();
    } catch (error) {
      // The subscription holds output back until the history is written, so a launch that failed
      // still has to release it or anything the PTY produced afterwards is stranded in the buffer.
      await this.gateway.replayInitial(this.session().id).catch(() => undefined);
      unlisten?.();
      unlisten = undefined;
      this.statusChanged.emit({ terminalId: this.session().id, status: 'FAILED' });
      this.terminal.writeln(
        `\u001b[38;2;224;108;117m${this.i18n.t('terminal.startFailed', { error: this.errorMessage(error) })}\u001b[0m`,
      );
    }
  }

  /**
   * Reports how much this client could display, leaving the actual size to the backend.
   *
   * The PTY is shared, so its size is the smallest of every attached viewer. Resizing the emulator
   * to what fits here would put it out of step with the PTY whenever another, narrower client is
   * watching: the agent only redraws the columns it believes exist, and everything past them would
   * keep showing stale output. The negotiated size arrives back as `terminal-resized`.
   */
  private fitTerminal(): void {
    if (!this.visible()) {
      return;
    }
    try {
      const proposed = this.fitAddon.proposeDimensions();
      if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
        return;
      }
      if (!this.runtimeReady) {
        // Nothing has been negotiated yet, so this client's own size is the best first guess.
        this.applyDimensions(proposed.cols, proposed.rows);
        return;
      }
      this.resizeCoordinator.schedule({
        cols: Math.max(proposed.cols, 1),
        rows: Math.max(proposed.rows, 1),
      });
    } catch {
      // The container may be temporarily hidden while the layout is changing.
    }
  }

  /**
   * Matches the emulator to a size, redrawing so the change is visible immediately.
   *
   * Reports whether the grid actually moved, because what is already on screen was drawn for the
   * grid this replaces and does not survive being rewrapped into the new one.
   */
  private applyDimensions(cols: number, rows: number): boolean {
    const safeCols = Math.max(Math.trunc(cols), 1);
    const safeRows = Math.max(Math.trunc(rows), 1);
    if (this.terminal.cols === safeCols && this.terminal.rows === safeRows) {
      return false;
    }
    try {
      this.terminal.resize(safeCols, safeRows);
      this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
      return true;
    } catch {
      // A terminal being torn down rejects the resize; the next fit will settle it.
      return false;
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

  private readonly prepareWheelInteraction = (event: WheelEvent): void => {
    // Touch scrolling synthesises wheel events; letting those focus the terminal would raise the
    // on-screen keyboard every time the user drags to read.
    if (!event.isTrusted) {
      return;
    }
    this.activateTerminal();
  };

  /**
   * Scrolls a full-screen agent by the wheel at the speed everything else scrolls at.
   *
   * On the alternate buffer xterm answers a wheel event with exactly one arrow key, however far
   * the wheel turned, so Codex CLI crawled a line per notch where Windows Terminal moves three and
   * xterm's own scrollback moves about the same. Taking the event here sends the whole distance.
   * Every other case is left to xterm, which already scrolls it at the right speed.
   */
  private readonly handleCustomWheel = (event: WheelEvent): boolean => {
    // Shift makes a wheel horizontal, which is not a scroll the buffer underneath can answer.
    if (event.shiftKey || this.scrollRoute() !== 'cursorKeys') {
      return true;
    }
    const rows = this.wheelRows.take(wheelScrollRows(event, this.terminal.rows));
    if (rows !== 0) {
      this.sendCursorScroll(rows);
    }
    return false;
  };

  /**
   * Scrolls with a finger, which xterm 6 does not do on its own.
   *
   * It renders to a canvas and moves its own scrollbar, so a drag reaches no scrollable element
   * and a phone can only ever see the last screenful. A tap is left alone so it still focuses the
   * terminal and raises the on-screen keyboard.
   */
  private readonly handleTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      return;
    }
    // A second touch during a glide means the user is reaching for a spot, not extending the flick.
    this.stopInertia();
    this.rememberTouchPoint(event.touches[0]);
    this.touchScroller.begin(event.touches[0].clientY, event.timeStamp, event.touches[0].clientX);
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      return;
    }
    this.rememberTouchPoint(event.touches[0]);
    const rows = this.touchScroller.drag(
      event.touches[0].clientY,
      event.timeStamp,
      event.touches[0].clientX,
    );
    if (!this.touchScroller.active) {
      return;
    }
    // Once this counts as a scroll, the page must not pan or rubber-band behind the terminal.
    event.preventDefault();
    if (rows !== 0) {
      this.scrollByRows(rows);
    }
  };

  private readonly handleTouchEnd = (event: TouchEvent): void => {
    const velocity = this.touchScroller.release(event.timeStamp);
    if (velocity !== 0) {
      this.inertiaVelocity = velocity;
      this.inertiaAt = performance.now();
      this.inertiaFrame = window.requestAnimationFrame(this.stepInertia);
    }
  };

  private readonly handleTouchCancel = (): void => {
    this.touchScroller.cancel();
    this.stopInertia();
  };

  /** Keeps a flick gliding after the finger lifts, the way a native scroll view does. */
  private readonly stepInertia = (now: number): void => {
    const frameMs = Math.max(1, now - this.inertiaAt);
    this.inertiaAt = now;
    const rows = this.touchScroller.glide(this.inertiaVelocity, frameMs);
    if (rows !== 0) {
      this.scrollByRows(rows);
    }
    this.inertiaVelocity = decayInertia(this.inertiaVelocity, frameMs);
    if (this.inertiaVelocity === 0 || this.destroyRef.destroyed) {
      this.inertiaFrame = undefined;
      return;
    }
    this.inertiaFrame = window.requestAnimationFrame(this.stepInertia);
  };

  private stopInertia(): void {
    if (this.inertiaFrame !== undefined) {
      window.cancelAnimationFrame(this.inertiaFrame);
      this.inertiaFrame = undefined;
    }
    this.inertiaVelocity = 0;
  }

  /**
   * Moves the terminal by the rows a drag covered, through whichever primitive reaches the agent.
   *
   * Handing xterm a synthetic wheel event covers every case but not at the finger's speed: it
   * damps pixel deltas under 50px to 30%, reading a row-sized step as a trackpad's, and answers
   * the alternate buffer with a single arrow key however far the wheel turned. A finger had to
   * travel four rows to move the buffer one, and Codex CLI — which runs full-screen without
   * tracking the mouse, so it only ever sees those arrow keys — could not be scrolled on a phone
   * at all. Routing each case explicitly keeps a drag tracking the finger row for row.
   */
  private scrollByRows(rows: number): void {
    const route = this.scrollRoute();
    if (route === 'mouseReport') {
      this.reportWheel(rows);
      return;
    }
    if (route === 'cursorKeys') {
      this.sendCursorScroll(rows);
      return;
    }
    this.terminal.scrollLines(rows);
  }

  private scrollRoute(): TerminalScrollRoute {
    return terminalScrollRoute(
      this.terminal.modes.mouseTrackingMode,
      this.terminal.buffer.active.type,
    );
  }

  /** Scrolls a full-screen agent, which reads a scroll as the arrow keys it binds to one. */
  private sendCursorScroll(rows: number): void {
    this.terminal.input(
      cursorScrollSequence(rows, this.terminal.modes.applicationCursorKeysMode),
      true,
    );
  }

  /**
   * Hands the drag to an agent that tracks the mouse, as the wheel it expects.
   *
   * xterm reports one wheel event per turn of the wheel and the agent scrolls by its own step, so
   * the damping that holds the other routes back lands close to the finger's own speed here.
   */
  private reportWheel(rows: number): void {
    const target = this.terminal.element?.querySelector<HTMLElement>('.xterm-viewport');
    if (!target) {
      return;
    }
    target.dispatchEvent(
      new WheelEvent('wheel', {
        // Negative rows mean older output, which is also the direction a negative deltaY scrolls.
        deltaY: rows * this.rowHeight(),
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        clientX: this.touchPoint.x,
        clientY: this.touchPoint.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  private rememberTouchPoint(touch: Touch): void {
    this.touchPoint = { x: touch.clientX, y: touch.clientY };
  }

  /**
   * Height of one row in CSS pixels.
   *
   * Measured from the rendered screen rather than the font settings, so it stays correct whatever
   * the font, the zoom, or the device pixel ratio turn the row into.
   */
  private rowHeight(): number {
    const screen = this.terminal.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!screen || this.terminal.rows <= 0) {
      return 0;
    }
    return screen.clientHeight / this.terminal.rows;
  }

  /**
   * Writes sequences xterm does not produce, then stops it from handling the event.
   *
   * Returning false also prevents the browser from treating Shift+Tab as focus navigation,
   * which would move focus out of the terminal entirely.
   */
  private readonly handleCustomKey = (event: KeyboardEvent): boolean => {
    // Tab shortcuts belong to the workbench. Declining them here keeps xterm from writing an
    // escape sequence to the PTY; the event still bubbles to the shell, which acts on it.
    if (workbenchShortcut(event)) {
      return false;
    }
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

  private readonly restoreCompositionAfterUpdate = (): void =>
    this.compositionAnchor?.restoreAfterBrowserUpdate();

  private readonly syncCompositionAfterRender = (): void =>
    this.compositionAnchor?.syncAfterRender();

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

  private readonly trackModifier = (event: KeyboardEvent): void => {
    this.ctrlHeld = event.ctrlKey;
  };

  /** A window that loses focus never reports the key going up, so the modifier is cleared here. */
  private readonly releaseModifier = (): void => {
    this.ctrlHeld = false;
  };

  /**
   * The links on the logical line the buffer row belongs to.
   *
   * Rows are joined back into the line the agent wrote, because a path or address long enough to
   * matter is exactly the one the terminal wrapped: matching per row would find its halves and
   * open neither.
   */
  private linksOnLine(bufferLineNumber: number): ILink[] | undefined {
    const buffer = this.terminal.buffer.active;
    // A buffer position is numbered from one while the buffer itself is indexed from zero, and
    // reading a row by its position lands on the row below it.
    const lineAt = (row: number) => buffer.getLine(row - 1);

    let firstRow = bufferLineNumber;
    while (firstRow > 1 && lineAt(firstRow)?.isWrapped) {
      firstRow -= 1;
    }

    const rows: TerminalRow[] = [];
    for (let row = firstRow; row <= buffer.length; row += 1) {
      const line = lineAt(row);
      if (!line || (row > firstRow && !line.isWrapped)) {
        break;
      }
      // Read cell by cell rather than as a string: a full-width character is one character in two
      // columns, and only the cells say which column each one starts at.
      const cells: TerminalCell[] = [];
      for (let column = 0; column < line.length; column += 1) {
        const cell = line.getCell(column);
        cells.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 });
      }
      rows.push({ row, cells });
    }

    const { text, positions } = readLogicalLine(rows);
    if (!text.trim()) {
      return undefined;
    }

    const links = detectTerminalLinks(text)
      .map((link) => this.toTerminalLink(link, positions))
      .filter(
        (link) => link.range.start.y <= bufferLineNumber && link.range.end.y >= bufferLineNumber,
      );
    return links.length > 0 ? links : undefined;
  }

  private toTerminalLink(link: TerminalLink, positions: TerminalLineText['positions']): ILink {
    const last = Math.min(link.end, positions.length) - 1;
    return {
      range: {
        start: positions[link.start],
        // A range ends on the last cell it covers rather than the one after it.
        end: positions[Math.max(link.start, last)],
      },
      text: link.text,
      activate: (event: MouseEvent, text: string) => {
        // The modifier is checked again at the click: the link was offered while it was held, but
        // nothing stops it being released before the button goes down.
        if (event.ctrlKey) {
          void this.openLink(link.kind, text);
        }
      },
    };
  }

  /**
   * Hands the target to the backend, which is the only side that can reach the machine.
   *
   * A failure is reported to the shell rather than written here. Anything written into the
   * emulator lands in the middle of whatever the agent is drawing — its composer above all — and
   * an agent redraws relative to its own cursor, so a line it never produced pushes its frame out
   * of place. The user still needs to know why nothing opened, so the shell raises a toast.
   */
  private async openLink(kind: TerminalLink['kind'], text: string): Promise<void> {
    try {
      await (kind === 'url'
        ? this.gateway.openUrl(text)
        : this.gateway.openPath(text, this.session().workingDirectory));
    } catch (error) {
      this.zone.run(() =>
        this.openFailed.emit(
          this.i18n.t('terminal.openFailed', {
            target: text,
            error: this.errorMessage(error),
          }),
        ),
      );
    }
  }

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
      // Clipboard access needs a secure context, which a remote client may not have.
      void navigator.clipboard?.writeText(selection).catch(() => undefined);
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
      const text = await navigator.clipboard?.readText();
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

  /**
   * Hands this view the terminal's size, because the user is now working in it.
   *
   * Sent only when this window would draw a different grid than the terminal currently uses, so
   * the common case — clicking around the view that already owns it — costs nothing.
   *
   * Typing does not call this: `proposeDimensions` measures the DOM, and forcing a synchronous
   * layout on every keystroke is what made input stutter. Reaching the keyboard means the view was
   * focused or clicked first, and both of those already claim the terminal.
   */
  private async claimTerminalSize(): Promise<void> {
    if (!this.runtimeReady) {
      return;
    }
    const proposed = this.fitAddon.proposeDimensions();
    if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
      return;
    }
    const cols = Math.max(proposed.cols, 1);
    const rows = Math.max(proposed.rows, 1);
    if (cols === this.terminal.cols && rows === this.terminal.rows) {
      return;
    }
    try {
      await this.gateway.resize(this.session().id, cols, rows, true);
    } catch (error) {
      console.warn('Terminal claim failed', this.errorMessage(error));
    }
  }

  /** Any sign the user started working in this view hands it the terminal's size. */
  private readonly claimOnFocus = (): void => void this.claimTerminalSize();

  /**
   * Draws this view again now that it is on screen with a grid of its own.
   *
   * The grid is taken first: claiming it after the screen was written would resize the emulator
   * underneath frames drawn for the grid before it, which is the same rewrap this redraw exists to
   * undo. A view that is visible without being the active one does not claim — the terminal
   * belongs to whoever the user is working in — and redraws at the grid the PTY already has.
   */
  private async redrawForOwnGrid(): Promise<void> {
    if (this.active()) {
      await this.claimTerminalSize();
    }
    await this.gateway.redraw(this.session().id);
  }

  private activateTerminal(): void {
    if (this.destroyRef.destroyed || !this.visible()) {
      return;
    }
    if (!this.active()) {
      this.selected.emit(this.session().id);
    }
    this.terminal.focus();
    void this.claimTerminalSize();
  }

  private handleOutput(data: string, replayed = false): void {
    if (!this.visible()) {
      // A hidden panel is `display: none`: it has no size to fit to, it never claims the terminal,
      // and its renderer has no box to paint onto. Whatever lands here was laid out for whichever
      // grid the PTY happened to have and drawn by a renderer that could not draw, so it has to be
      // drawn again once the view is on screen with a grid of its own.
      this.wroteWhileHidden = true;
    }
    if (replayed) {
      // The callback runs once xterm has parsed this chunk, which is the whole window in which
      // the history could make it answer something.
      this.replayGate.begin();
      this.terminal.write(data, () => this.replayGate.end());
    } else {
      this.terminal.write(data);
    }
    this.outputTail = `${this.outputTail}${data}`.slice(-2_000);
    // Replayed scrollback was already analysed when it first arrived. Feeding a whole terminal's
    // history back through the task, handoff and startup readers on every reconnect is what made
    // restoring terminals stall, and it would count the same output twice.
    if (replayed) {
      return;
    }
    this.outputCaptured.emit({ terminalId: this.session().id, data });
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
