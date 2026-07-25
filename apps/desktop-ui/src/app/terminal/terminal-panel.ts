import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { TERMINAL_STATUS_LABELS, TerminalSession } from '../core/models/workspace.models';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { IconComponent } from '../shared/icon/icon';

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
    scrollback: 3_000,
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

  readonly session = input.required<TerminalSession>();
  readonly active = input(false);
  readonly selected = output<string>();
  readonly closeRequested = output<string>();

  protected readonly statusLabels = TERMINAL_STATUS_LABELS;

  ngAfterViewInit(): void {
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.container().nativeElement);
    this.fitTerminal();

    const stopped = this.session().status === 'STOPPED';
    if (stopped) {
      this.terminal.writeln('\u001b[38;2;150;157;164m已恢复终端配置，原进程未重新启动。\u001b[0m');
      this.terminal.writeln('请从会话中心恢复 Claude 会话，或新建终端。');
    } else {
      void this.initializeRuntime();
    }
    const inputDisposable = stopped
      ? { dispose: () => undefined }
      : this.terminal.onData((data) => {
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

  private async initializeRuntime(): Promise<void> {
    const unlisten = await this.gateway.connect(this.session().id, (data) =>
      this.terminal.write(data),
    );
    this.destroyRef.onDestroy(unlisten);

    await this.gateway.start(
      this.session(),
      Math.max(this.terminal.cols, 20),
      Math.max(this.terminal.rows, 5),
    );
  }

  private fitTerminal(): void {
    try {
      this.fitAddon.fit();
      void this.gateway.resize(this.session().id, this.terminal.cols, this.terminal.rows);
    } catch {
      // The container may be temporarily hidden while the layout is changing.
    }
  }
}
