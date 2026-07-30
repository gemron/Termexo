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
import { detectTerminalRuntimeIssue, TerminalRuntimeIssue } from './terminal-runtime-diagnostics';

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
    scrollOnUserInput: false,
    smoothScrollDuration: 90,
    minimumContrastRatio: 4.5,
    allowTransparency: true,
    theme: {
      background: '#101312',
      foreground: '#c9cecb',
      cursor: '#58c7a0',
      cursorAccent: '#101312',
      selectionBackground: '#31594c',
      black: '#151817',
      red: '#e06c75',
      green: '#70bd91',
      yellow: '#d6a34a',
      blue: '#68a9e8',
      magenta: '#b494d6',
      cyan: '#61b8b5',
      white: '#d8dcd9',
      brightBlack: '#656b68',
    },
  });
  private readonly fitAddon = new FitAddon();
  private resizeObserver?: ResizeObserver;
  private runtimeReady = false;
  private viewReady = false;
  private outputTail = '';
  private lastRuntimeIssue: TerminalRuntimeIssue = null;

  readonly session = input.required<TerminalSession>();
  readonly active = input(false);
  readonly visible = input(true);
  readonly maximized = input(false);
  readonly fontSize = input(12);
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
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.container().nativeElement);
    this.fitTerminal();

    void this.initializeRuntime();
    const inputDisposable = this.terminal.onData((data) => {
      if (data.includes('\r')) {
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

    this.resizeObserver = new ResizeObserver(() => this.fitTerminal());
    this.resizeObserver.observe(this.container().nativeElement);

    this.destroyRef.onDestroy(() => {
      inputDisposable.dispose();
      this.resizeObserver?.disconnect();
      this.terminal.dispose();
    });
  }

  focus(): void {
    this.selected.emit(this.session().id);
    this.terminal.focus();
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
        void this.resizeRuntime();
      }
    } catch {
      // The container may be temporarily hidden while the layout is changing.
    }
  }

  private scheduleFit(): void {
    window.requestAnimationFrame(() => {
      if (this.destroyRef.destroyed || !this.visible()) {
        return;
      }
      this.fitTerminal();
      window.requestAnimationFrame(() => {
        if (!this.destroyRef.destroyed && this.visible()) {
          this.fitTerminal();
        }
      });
    });
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

  private async resizeRuntime(): Promise<void> {
    try {
      await this.gateway.resize(this.session().id, this.terminal.cols, this.terminal.rows);
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        console.warn('Terminal resize failed', {
          terminalId: this.session().id,
          error: this.errorMessage(error),
        });
      }
    }
  }
}
