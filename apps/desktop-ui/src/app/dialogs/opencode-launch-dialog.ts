import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { type AgentInstallation } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface OpenCodeLaunchDialogValue {
  name: string;
  model?: string;
}

@Component({
  selector: 'app-opencode-launch-dialog',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog compact modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="opencode-launch-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="terminal" [size]="17" /></span>
            <div>
              <h2 id="opencode-launch-title">新建 OpenCode 会话</h2>
              <p>{{ workingDirectory() }}</p>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            title="关闭"
            aria-label="关闭"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="installation-line" [class.unavailable]="!installation()?.healthy">
          <i></i>
          <span>{{ installation()?.diagnostic ?? '正在检测 OpenCode...' }}</span>
          <code>{{ installation()?.version ?? '' }}</code>
        </div>

        <div class="form-grid">
          <label class="wide">
            <span>会话名称</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              placeholder="例如：实现 OpenCode 适配"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              autofocus
            />
          </label>
          <label class="wide">
            <span>模型（可选）</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              placeholder="provider/model，例如 anthropic/claude-sonnet-4-5"
              [ngModel]="model()"
              (ngModelChange)="model.set($event)"
            />
            <small>留空时使用 OpenCode 自身配置的默认模型；凭据请在 OpenCode 中配置。</small>
          </label>
        </div>

        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            取消
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!canLaunch()"
            (click)="submit()"
          >
            <app-icon name="play" [size]="13" />启动
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class OpenCodeLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly workingDirectory = input('');
  readonly launched = output<OpenCodeLaunchDialogValue>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly canLaunch = computed(() => Boolean(this.installation()?.healthy));

  protected submit(): void {
    if (!this.canLaunch()) {
      return;
    }
    this.launched.emit({
      name: this.name().trim(),
      model: this.model().trim() || undefined,
    });
  }
}
