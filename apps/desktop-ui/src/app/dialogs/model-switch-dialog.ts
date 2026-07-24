import { Component, input, output, signal } from '@angular/core';

import { MODEL_PROFILES } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-model-switch-dialog',
  imports: [IconComponent],
  template: `
    <div class="backdrop" (mousedown)="cancelled.emit()">
      <section
        class="dialog model-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="model-dialog-title">切换 Workspace 模型</h2>
            <p>先预览兼容性，再执行批量切换。</p>
          </div>
          <button type="button" title="关闭" aria-label="关闭" (click)="cancelled.emit()">
            <app-icon name="x" [size]="15" />
          </button>
        </header>
        <div class="profile-list">
          @for (profile of profiles; track profile.id) {
            <button
              type="button"
              class="profile-option"
              [class.selected]="profile.id === selectedProfileId()"
              (click)="selectedProfileId.set(profile.id)"
            >
              <i [style.background]="profile.tone"></i>
              <span
                ><strong>{{ profile.name }}</strong
                ><small>{{ profile.provider }} · {{ profile.model }}</small></span
              >
              @if (profile.id === selectedProfileId()) {
                <app-icon name="check" [size]="15" />
              }
            </button>
          }
        </div>
        <div class="switch-plan">
          <div>
            <strong>{{ agentCount() }}</strong
            ><span>原生切换</span>
          </div>
          <div><strong>0</strong><span>重启恢复</span></div>
          <div><strong>0</strong><span>上下文迁移</span></div>
        </div>
        <footer>
          <button type="button" class="secondary" (click)="cancelled.emit()">取消</button>
          <button type="button" class="primary" (click)="confirmed.emit(selectedProfileId())">
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
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();
  readonly selectedProfileId = signal(MODEL_PROFILES[0]?.id ?? '');

  protected readonly profiles = MODEL_PROFILES;
}
