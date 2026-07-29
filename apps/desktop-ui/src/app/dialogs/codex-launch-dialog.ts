import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AccountProfile, AgentInstallation } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface CodexLaunchDialogValue {
  name: string;
  model?: string;
  accountProfileId?: string;
}

const CODEX_MODEL_SUGGESTIONS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const;

@Component({
  selector: 'app-codex-launch-dialog',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog compact modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-launch-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="terminal" [size]="17" /></span>
            <div>
              <h2 id="codex-launch-title">新建 Codex 会话</h2>
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
          <span>{{ installation()?.diagnostic ?? '正在检测 Codex CLI' }}</span>
          <code>{{ installation()?.version ?? '' }}</code>
        </div>

        <div class="form-grid">
          <label class="wide">
            <span>会话名称</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              placeholder="例如：review-release"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              autofocus
            />
          </label>
          <label class="wide">
            <span>ChatGPT 登录账号</span>
            <select
              class="select select-bordered select-sm"
              [ngModel]="resolvedAccountProfileId()"
              (ngModelChange)="accountProfileId.set($event)"
            >
              @for (profile of codexAccounts(); track profile.id) {
                <option [value]="profile.id">
                  {{ profile.name }} · {{ profile.authenticated ? '已登录' : '未登录' }}
                </option>
              }
            </select>
          </label>
          <label class="wide">
            <span>Codex 模型</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              list="codex-model-suggestions"
              placeholder="留空使用 Codex 配置的默认模型"
              aria-label="Codex 模型"
              [ngModel]="model()"
              (ngModelChange)="model.set($event)"
            />
            <datalist id="codex-model-suggestions">
              @for (suggestion of modelSuggestions; track suggestion) {
                <option [value]="suggestion"></option>
              }
            </datalist>
            <small>可选择推荐模型，也可输入当前 Codex CLI 支持的任意模型 ID。</small>
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
            <app-icon name="play" [size]="13" />启动会话
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class CodexLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launched = output<CodexLaunchDialogValue>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly accountProfileId = signal('');
  protected readonly modelSuggestions = CODEX_MODEL_SUGGESTIONS;
  protected readonly codexAccounts = computed(() =>
    this.accountProfiles().filter((profile) => profile.agentType === 'codex'),
  );
  protected readonly resolvedAccountProfileId = computed(
    () =>
      this.accountProfileId() ||
      this.codexAccounts().find((profile) => profile.isDefault)?.id ||
      this.codexAccounts()[0]?.id ||
      '',
  );
  protected readonly canLaunch = computed(
    () => Boolean(this.installation()?.healthy) && Boolean(this.resolvedAccountProfileId()),
  );

  protected submit(): void {
    if (!this.canLaunch()) {
      return;
    }
    this.launched.emit({
      name: this.name().trim(),
      model: this.model().trim() || undefined,
      accountProfileId: this.resolvedAccountProfileId() || undefined,
    });
  }
}
