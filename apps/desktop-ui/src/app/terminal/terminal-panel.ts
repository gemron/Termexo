import {
  AfterViewInit,
  Component,
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

import {
  TERMINAL_STATUS_LABELS,
  normalizeTerminalFontSize,
  TerminalSession,
  TerminalStatus,
} from '../core/models/workspace.models';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { IconComponent } from '../shared/icon/icon';
import { TerminalResizeCoordinator } from './terminal-resize-coordinator';
import { detectTerminalRuntimeIssue, TerminalRuntimeIssue } from './terminal-runtime-diagnostics';
import { createTerminalTheme } from './terminal-theme';

@Component({
  selector: 'app-terminal-panel',
  imports: [IconComponent],
  templateUrl: './terminal-panel.html',
  styleUrl: './terminal-panel.scss',
})
export class TerminalPanelComponent implements AfterViewInit {
  private readonly gateway = inject(TerminalGatewayService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('terminal');
  private readonly terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
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
  private runtimeReady = false;
  private viewReady = false;
  private outputTail = '';
  private lastRuntimeIssue: TerminalRuntimeIssue = null;

  readonly session = input.required<TerminalSession>();
  readonly active = input(false);
  readonly visible = input(true);
  readonly maximized = input(false);
  readonly fontSize = input(12);
  readonly themeColor = input<string>();
  readonly selected = output<string>();
  readonly closeRequested = output<string>();
  readonly maximizeRequested = output<string>();
  readonly statusChanged = output<{ terminalId: string; status: TerminalStatus }>();

  protected readonly statusLabels = TERMINAL_STATUS_LABELS;
  protected readonly runtimeNotice = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.terminal.options.fontSize = normalizeTerminalFontSize(this.fontSize());
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
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.terminal.loadAddon(this.fitAddon);
    const terminalContainer = this.container().nativeElement;
    this.terminal.open(terminalContainer);
    terminalContainer.addEventListener('wheel', this.prepareWheelInteraction, {
      capture: true,
      passive: true,
    });
    terminalContainer.addEventListener('wheel', this.stopWheelPropagation, { passive: true });
    this.fitTerminal();
    this.scheduleFit();
    if (this.active() && this.visible()) {
      this.scheduleActivation();
    }

    void this.initializeRuntime();
    const inputDisposable = this.terminal.onData((data) => {
      if (data.includes('\r')) {
        this.terminal.scrollToBottom();
        this.runtimeNotice.set(null);
        this.lastRuntimeIssue = null;
        this.outputTail = '';
        this.statusChanged.emit({
          terminalId: this.session().id,
          status: this.session().agentType === 'shell' ? 'RUNNING' : 'THINKING',
        });
      }
      void this.gateway.write(this.session(), data);
    });

    this.resizeObserver = new ResizeObserver(() => this.scheduleFit(false));
    this.resizeObserver.observe(terminalContainer);

    this.destroyRef.onDestroy(() => {
      inputDisposable.dispose();
      this.resizeObserver?.disconnect();
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
    this.runtimeNotice.set(null);
  }

  private async initializeRuntime(): Promise<void> {
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await this.gateway.connect(this.session().id, (data) => this.handleOutput(data));
      if (this.destroyRef.destroyed) {
        unlisten();
        unlisten = undefined;
        return;
      }
      this.destroyRef.onDestroy(() => {
        unlisten?.();
        unlisten = undefined;
      });

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
        `\u001b[38;2;224;108;117m终端启动失败：${this.errorMessage(error)}\u001b[0m`,
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
      this.runtimeNotice.set(
        '供应商返回 429 限流。Claude CLI 可能自动重试，请先等待状态更新，避免重复提交。',
      );
      this.statusChanged.emit({ terminalId: this.session().id, status: 'RATE_LIMITED' });
      return;
    }
    this.runtimeNotice.set('Claude 请求超时。可等待 CLI 重试，或检查代理与供应商状态。');
    this.statusChanged.emit({ terminalId: this.session().id, status: 'WAITING_INPUT' });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
