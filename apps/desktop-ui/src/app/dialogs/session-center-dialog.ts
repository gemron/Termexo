import { DatePipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  AgentInstallation,
  AgentSession,
  McpProfile,
  ModelProfile,
} from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface ResumeSessionValue {
  session: AgentSession;
  profileId?: string;
  mcpProfileId?: string;
}

@Component({
  selector: 'app-session-center-dialog',
  imports: [DatePipe, FormsModule, IconComponent],
  template: `
    <div class="backdrop" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog session-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-center-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="history" [size]="17" /></span>
            <div>
              <h2 id="session-center-title">Claude 会话中心</h2>
              <p>{{ sessions().length }} 个本地会话</p>
            </div>
          </div>
          <button type="button" title="关闭" aria-label="关闭" (click)="cancelled.emit()">
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="session-toolbar">
          <label class="dialog-search">
            <app-icon name="search" [size]="14" />
            <input
              type="search"
              placeholder="搜索名称、路径或分支"
              [ngModel]="search()"
              (ngModelChange)="search.set($event)"
            />
          </label>
          <label class="checkbox-control">
            <input
              type="checkbox"
              [ngModel]="onlyWorkspace()"
              (ngModelChange)="onlyWorkspace.set($event); refresh()"
            />
            <span>当前工作区</span>
          </label>
          <button
            type="button"
            class="icon-action"
            title="重新扫描"
            aria-label="重新扫描"
            [disabled]="busy()"
            (click)="refresh()"
          >
            <app-icon name="refresh" [size]="14" />
          </button>
        </div>

        <div class="resume-options">
          <label>
            <span>模型 Profile</span>
            <select [ngModel]="resolvedProfileId()" (ngModelChange)="profileId.set($event)">
              @for (profile of profiles(); track profile.id) {
                <option [value]="profile.id">{{ profile.name }}</option>
              }
            </select>
          </label>
          <label>
            <span>MCP Profile</span>
            <select [ngModel]="mcpProfileId()" (ngModelChange)="mcpProfileId.set($event)">
              <option value="">Claude 默认配置</option>
              @for (profile of mcpProfiles(); track profile.id) {
                <option [value]="profile.id">{{ profile.name }}</option>
              }
            </select>
          </label>
          <span class="installation-badge" [class.unavailable]="!installation()?.healthy">
            <i></i>{{ installation()?.version ?? '未连接' }}
          </span>
        </div>

        <div class="session-list">
          @for (session of filteredSessions(); track session.id) {
            <article class="session-row">
              <span class="session-agent"><app-icon name="bot" [size]="15" /></span>
              <div class="session-copy">
                <strong>{{ session.title }}</strong>
                <small>{{ session.projectPath ?? '未知项目' }}</small>
                <div>
                  <span>{{ session.branch ?? '无分支' }}</span>
                  <span>{{ session.modelName ?? '默认模型' }}</span>
                  <span>{{ session.messageCount }} 条消息</span>
                </div>
              </div>
              <time [attr.datetime]="session.lastUsedAt">{{
                session.lastUsedAt | date: 'MM-dd HH:mm'
              }}</time>
              <button
                type="button"
                class="resume-button"
                [disabled]="!installation()?.healthy"
                (click)="resume(session)"
              >
                <app-icon name="play" [size]="12" />恢复
              </button>
            </article>
          } @empty {
            <div class="dialog-empty">
              <app-icon name="history" [size]="22" />
              <strong>没有匹配的 Claude 会话</strong>
              <span>调整筛选条件或重新扫描本机会话目录。</span>
            </div>
          }
        </div>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class SessionCenterDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly sessions = input<AgentSession[]>([]);
  readonly profiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly projectPath = input('');
  readonly busy = input(false);
  readonly refreshed = output<string | undefined>();
  readonly resumed = output<ResumeSessionValue>();
  readonly cancelled = output<void>();

  protected readonly search = signal('');
  protected readonly onlyWorkspace = signal(true);
  protected readonly profileId = signal('');
  protected readonly mcpProfileId = signal('');
  protected readonly resolvedProfileId = computed(
    () =>
      this.profileId() ||
      this.profiles().find((profile) => profile.isDefault)?.id ||
      this.profiles()[0]?.id ||
      '',
  );
  protected readonly filteredSessions = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.sessions().filter((session) => {
      if (!query) {
        return true;
      }
      return [session.title, session.projectPath, session.branch, session.modelName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query));
    });
  });

  protected refresh(): void {
    this.refreshed.emit(this.onlyWorkspace() ? this.projectPath() : undefined);
  }

  protected resume(session: AgentSession): void {
    this.resumed.emit({
      session,
      profileId: this.resolvedProfileId() || undefined,
      mcpProfileId: this.mcpProfileId() || undefined,
    });
  }
}
