import { Component, computed, input, output, signal } from '@angular/core';

import { ModelProfile } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-model-switch-dialog',
  imports: [IconComponent],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog model-dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="model-dialog-title">切换 Claude Code 后端模型</h2>
            <p>CLI 客户端保持不变，通过 Profile 切换供应商、Endpoint 和模型。</p>
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
        <div class="profile-list">
          @for (profile of profiles(); track profile.id) {
            <button
              type="button"
              class="profile-option card"
              [class.selected]="profile.id === resolvedProfileId()"
              (click)="selectedProfileId.set(profile.id)"
            >
              <i [style.background]="profileTone(profile.provider)"></i>
              <span
                ><strong>{{ profile.name }}</strong
                ><small>{{ profile.provider }} · {{ profile.model }}</small></span
              >
              @if (profile.id === resolvedProfileId()) {
                <app-icon name="check" [size]="15" />
              }
            </button>
          } @empty {
            <div class="dialog-empty">
              <strong>还没有模型 Profile</strong>
              <span>请先在设置中配置 Anthropic、DeepSeek、MiniMax 或 GLM。</span>
            </div>
          }
        </div>
        <div class="switch-plan">
          <div><strong>Claude Code</strong><span>CLI 保持不变</span></div>
          <div>
            <strong>{{ agentCount() }}</strong
            ><span>终端重启应用参数</span>
          </div>
          <div><strong>新会话</strong><span>避免跨供应商重放上下文与重复 token</span></div>
        </div>
        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            取消
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="busy() || !resolvedProfileId()"
            (click)="confirmed.emit(resolvedProfileId())"
          >
            执行切换
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './dialog.scss',
})
export class ModelSwitchDialogComponent {
  readonly agentCount = input(0);
  readonly profiles = input<ModelProfile[]>([]);
  readonly busy = input(false);
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();
  readonly selectedProfileId = signal('');
  protected readonly resolvedProfileId = computed(
    () =>
      this.selectedProfileId() ||
      this.profiles().find((profile) => profile.isDefault)?.id ||
      this.profiles()[0]?.id ||
      '',
  );

  protected profileTone(provider: string): string {
    const tones: Record<string, string> = {
      Anthropic: '#d97757',
      DeepSeek: '#4d6bfe',
      MiniMax: '#7f68dc',
      GLM: '#58c7a0',
    };
    return tones[provider] ?? '#68a9e8';
  }
}
