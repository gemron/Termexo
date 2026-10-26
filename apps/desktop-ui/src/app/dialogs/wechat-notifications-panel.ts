import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../core/services/app-state.service';
import { WechatNotificationsService } from '../core/services/wechat-notifications.service';
import { runtimeMode } from '../core/services/tauri-runtime';
import type { WechatSettings } from '../core/models/wechat-notifications';
import { ThirdPartyNotificationsService } from '../core/services/third-party-notifications.service';

@Component({
  selector: 'app-wechat-notifications-panel',
  imports: [FormsModule],
  template: ` <section class="wechat-panel">
    <h3>微信消息通知</h3>
    <p>
      使用已登录的 Windows
      桌面微信。默认关闭；启用后，以下事件会自动通知所选目标。授权提醒不会批准操作。
    </p>
    @if (!available) {
      <p role="status">只能在 Windows 桌面版配置和使用。</p>
    }
    @if (available && notifications.initialized() && !notifications.enabled()) {
      <p role="status">第三方通知总开关已暂停。微信配置会保留，请在顶部“第三方通知”开关恢复发送。</p>
    }
    <fieldset [disabled]="!available || busy()">
      <legend>接收目标</legend>
      <label
        ><input
          type="checkbox"
          class="checkbox checkbox-sm"
          [ngModel]="draft().enabled"
          (ngModelChange)="patch({ enabled: $event })"
        />启用微信通知</label
      >
      <label
        >完整联系人 / 群名称<input
          class="input input-bordered"
          [ngModel]="draft().target"
          (ngModelChange)="patch({ target: $event })"
      /></label>
      <p>
        默认“文件传输助手”。必须唯一匹配搜索结果及聊天标题；不支持的微信版本、重名或已有草稿时拒绝发送。会切换微信聊天。
      </p>
    </fieldset>
    <fieldset [disabled]="!available || busy()">
      <legend>通知事件</legend>
      <div class="events">
        <label
          ><input
            type="checkbox"
            [ngModel]="draft().completed"
            (ngModelChange)="patch({ completed: $event })"
          />任务完成</label
        >
        <label
          ><input
            type="checkbox"
            [ngModel]="draft().errors"
            (ngModelChange)="patch({ errors: $event })"
          />错误 / 限流</label
        >
        <label
          ><input
            type="checkbox"
            [ngModel]="draft().approval"
            (ngModelChange)="patch({ approval: $event })"
          />等待授权</label
        >
        <label
          ><input
            type="checkbox"
            [ngModel]="draft().input"
            (ngModelChange)="patch({ input: $event })"
          />等待输入</label
        >
      </div>
    </fieldset>
    <fieldset [disabled]="!available || busy()">
      <legend>项目范围</legend>
      <label
        ><input
          type="checkbox"
          [checked]="draft().allWorkspaces"
          (change)="allProjects($any($event.target).checked)"
        />全部项目（否则只通知下方所选项目）</label
      >
      @if (!draft().allWorkspaces) {
        @for (workspace of state.workspaces(); track workspace.id) {
          <label
            ><input
              type="checkbox"
              [checked]="draft().workspaceIds.includes(workspace.id)"
              (change)="toggleProject(workspace.id, $any($event.target).checked)"
            />{{ workspace.name }}</label
          >
        } @empty {
          <p>暂无项目，请先添加工作区。</p>
        }
        @if (!draft().workspaceIds.length) {
          <p>尚未选择项目，当前不会发送项目通知。</p>
        }
      }
    </fieldset>
    @if (busy()) {
      <p class="feedback" role="status">{{ busyLabel() }}</p>
    }
    @if (message()) {
      <p
        class="feedback"
        [class.error]="messageError()"
        [attr.role]="messageError() ? 'alert' : 'status'"
      >
        {{ message() }}
      </p>
    }
    @if (flow.error()) {
      <p class="error" role="alert">{{ flow.error() }}</p>
    }
    <div class="buttons">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        [disabled]="!available || busy()"
        (click)="save()"
      >
        保存通知配置
      </button>
      <button type="button" class="btn btn-sm" [disabled]="!available || busy()" (click)="probe()">
        检查目标（不发送）
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        [disabled]="!available || busy()"
        (click)="refresh()"
      >
        刷新记录
      </button>
    </div>
    <details>
      <summary>检查与投递说明</summary>
      <p>
        检查只核对目标及可访问性，不输入消息、不点击发送。实际发送链路尚需在你的微信版本下单独验证；“已提交”只表示微信界面中已出现消息，不代表对方已读。没有自动重试，避免重复消息。
      </p>
    </details>
    <h4>最近通知</h4>
    @for (item of flow.history(); track item.id) {
      <article>
        <strong>{{ statusLabel(item.status) }} · {{ item.target }}</strong
        ><small>{{ kindLabel(item.kind) }} · {{ time(item.createdAt) }}</small>
        <p>{{ item.detail }}</p>
      </article>
    } @empty {
      <p>暂无投递记录。恢复时不补发旧状态；普通 Shell、前后端长期进程和登录终端不通知。</p>
    }
  </section>`,
  styles: [
    `
      fieldset {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-field);
        padding: 8px 12px;
        margin: 14px 0;
        background: var(--surface-inset);
      }
      legend {
        font-size: 12px;
        font-weight: 600;
        padding: 0 5px;
      }
      summary {
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        margin: 12px 0;
      }
      .feedback {
        padding: 10px 12px;
        border-left: 3px solid var(--color-primary);
        background: var(--primary-soft);
        overflow-wrap: anywhere;
      }
      .wechat-panel {
        padding: 20px;
        min-width: 0;
        max-width: 850px;
      }
      h3,
      h4 {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 12px;
      }
      p,
      small {
        font-size: 12px;
        line-height: 1.7;
        color: var(--text-secondary);
      }
      label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        margin: 12px 0;
        flex-wrap: wrap;
      }
      input[type='text'],
      .input {
        width: 100%;
      }
      .events,
      .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      article {
        border-top: 1px solid var(--border);
        padding: 10px 0;
      }
      small {
        display: block;
      }
      .error {
        color: var(--color-error);
      }
      .feedback.error {
        border-left-color: var(--color-error);
        background: color-mix(in srgb, var(--color-error) 8%, var(--surface-inset));
      }
    `,
  ],
})
export class WechatNotificationsPanelComponent {
  protected readonly state = inject(AppStateService);
  protected readonly flow = inject(WechatNotificationsService);
  protected readonly notifications = inject(ThirdPartyNotificationsService);
  protected readonly available = runtimeMode() === 'desktop';
  protected readonly draft = signal<WechatSettings>({
    ...this.flow.settings(),
    workspaceIds: [...this.flow.settings().workspaceIds],
  });
  protected readonly busy = signal(false);
  protected readonly busyLabel = signal('');
  protected readonly message = signal('');
  protected readonly messageError = signal(false);
  constructor() {
    if (this.available) void this.refresh(true);
  }
  protected patch(patch: Partial<WechatSettings>): void {
    this.draft.update((value) => ({ ...value, ...patch }));
  }
  protected allProjects(checked: boolean): void {
    this.patch({ allWorkspaces: checked });
  }
  protected toggleProject(id: string, checked: boolean): void {
    const ids = new Set(this.draft().workspaceIds);
    if (checked) ids.add(id);
    else ids.delete(id);
    this.patch({ workspaceIds: [...ids], allWorkspaces: false });
  }
  protected async operation(operation: () => Promise<void>, label: string): Promise<void> {
    if (this.busy()) return;
    this.busyLabel.set(label);
    this.busy.set(true);
    this.message.set('');
    this.messageError.set(false);
    try {
      await operation();
    } catch (error) {
      this.messageError.set(true);
      this.message.set(String(error));
    } finally {
      this.busy.set(false);
    }
  }
  protected async save(): Promise<void> {
    await this.operation(async () => {
      await this.flow.save(this.draft());
      this.message.set('通知配置已保存。');
    }, '正在保存通知配置…');
  }
  protected async probe(): Promise<void> {
    await this.operation(async () => {
      const result = await this.flow.probe(this.draft().target);
      this.messageError.set(result.status !== 'ready');
      this.message.set(
        result.status === 'ready'
          ? '目标检查通过。聊天已打开，输入框为空且可写，发送按钮可见。未输入或发送消息；实际发送仍需单独验证。'
          : result.detail,
      );
    }, '正在切换微信并检查目标，请稍候；不会输入或发送消息…');
  }
  protected async refresh(initial = false): Promise<void> {
    await this.operation(async () => {
      await this.flow.refresh();
      if (initial)
        this.draft.set({
          ...this.flow.settings(),
          workspaceIds: [...this.flow.settings().workspaceIds],
        });
      if (!initial) this.message.set('通知记录已刷新，未保存的配置保持不变。');
    }, '正在读取通知记录…');
  }
  protected kindLabel(kind: string): string {
    return (
      (
        {
          completed: '任务完成',
          error: '错误 / 限流',
          approval: '等待授权',
          input: '等待输入',
        } as Record<string, string>
      )[kind] ?? kind
    );
  }
  protected statusLabel(status: string): string {
    return (
      (
        {
          pending: '结果待确认',
          submitted: '已提交微信',
          failed: '未发送',
          uncertain: '结果不确定',
        } as Record<string, string>
      )[status] ?? status
    );
  }
  protected time(value: number): string {
    return new Date(value).toLocaleString();
  }
}
