import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AgentInstallation, McpProfile, ModelProfile } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface ClaudeLaunchDialogValue {
  name: string;
  profileId?: string;
  mcpProfileId?: string;
}

@Component({
  selector: 'app-claude-launch-dialog',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claude-launch-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="bot" [size]="17" /></span>
            <div>
              <h2 id="claude-launch-title">新建 Claude 会话</h2>
              <p>{{ workingDirectory() }}</p>
            </div>
          </div>
          <button type="button" title="关闭" aria-label="关闭" (click)="cancelled.emit()">
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="installation-line" [class.unavailable]="!installation()?.healthy">
          <i></i>
          <span>{{ installation()?.diagnostic ?? '正在检测 Claude Code' }}</span>
          <code>{{ installation()?.version ?? '' }}</code>
        </div>

        <div class="form-grid">
          <label class="wide">
            <span>会话名称</span>
            <input
              type="text"
              placeholder="例如：auth-refactor"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              autofocus
            />
          </label>
          <label>
            <span>模型 Profile</span>
            <select [ngModel]="resolvedProfileId()" (ngModelChange)="profileId.set($event)">
              @for (profile of profiles(); track profile.id) {
                <option [value]="profile.id">{{ profile.name }} · {{ profile.model }}</option>
              }
            </select>
          </label>
          <label>
            <span>MCP Profile</span>
            <select [ngModel]="mcpProfileId()" (ngModelChange)="mcpProfileId.set($event)">
              <option value="">使用 Claude 默认配置</option>
              @for (profile of mcpProfiles(); track profile.id) {
                <option [value]="profile.id">{{ profile.name }}</option>
              }
            </select>
          </label>
        </div>

        <footer>
          <button type="button" class="secondary" (click)="cancelled.emit()">取消</button>
          <button type="button" class="primary" [disabled]="!canLaunch()" (click)="submit()">
            <app-icon name="play" [size]="13" />启动会话
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class ClaudeLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly profiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launched = output<ClaudeLaunchDialogValue>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly profileId = signal('');
  protected readonly mcpProfileId = signal('');
  protected readonly resolvedProfileId = computed(
    () =>
      this.profileId() ||
      this.profiles().find((profile) => profile.isDefault)?.id ||
      this.profiles()[0]?.id ||
      '',
  );
  protected readonly canLaunch = computed(
    () => Boolean(this.installation()?.healthy) && Boolean(this.resolvedProfileId()),
  );

  protected submit(): void {
    if (!this.canLaunch()) {
      return;
    }
    this.launched.emit({
      name: this.name().trim(),
      profileId: this.resolvedProfileId() || undefined,
      mcpProfileId: this.mcpProfileId() || undefined,
    });
  }
}
