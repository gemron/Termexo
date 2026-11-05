import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { registerTranslations } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { DirectoryPickerService } from '../core/services/directory-picker.service';
import {
  OneRingPluginService,
  type OneRingSettings,
  type OneRingStatus,
} from '../core/services/one-ring-plugin.service';

registerTranslations({
  en: {
    'codexPlugins.title': 'Codex plugins',
    'codexPlugins.enable': 'Enable One Ring',
    'codexPlugins.source': 'One Ring source or release directory',
    'codexPlugins.node': 'Node.js executable (24 or later)',
    'codexPlugins.browse': 'Choose directory',
    'codexPlugins.check': 'Check environment',
    'codexPlugins.save': 'Save',
    'codexPlugins.desktop': 'Manage Codex plugins in the Termexo desktop app.',
    'codexPlugins.description':
      'One Ring manages persistent CLI Workers and task results. Workers open as terminal tabs in their Host workspace. Currently supported: Linux/Codex.',
    'codexPlugins.install':
      'Build One Ring with npm run build first. On first launch its native plugin is installed in the selected Codex account; model and sign-in settings are preserved. Codex still manages tool approvals.',
    'codexPlugins.saved': 'Saved. Open a new Codex terminal to apply these settings.',
    'codexPlugins.lifecycle':
      'Changes apply to new terminals. Disabling prevents new embedded Workers; close active Workers through the Host before closing it. The native account plugin stays installed.',
  },
  'zh-CN': {
    'codexPlugins.title': 'Codex 插件',
    'codexPlugins.enable': '启用 One Ring',
    'codexPlugins.source': 'One Ring 源码或发行包目录',
    'codexPlugins.node': 'Node.js 可执行文件（24 或更高版本）',
    'codexPlugins.browse': '选择目录',
    'codexPlugins.check': '检查环境',
    'codexPlugins.save': '保存',
    'codexPlugins.desktop': '请在 Termexo 桌面应用中管理 Codex 插件。',
    'codexPlugins.description':
      'One Ring 管理持续的 CLI Worker 会话和逐轮任务结果。Worker 在 Host 所属工作区打开为终端标签，当前支持 Linux/Codex。',
    'codexPlugins.install':
      '先在 One Ring 目录执行 npm run build。首次启动时，原生插件会安装到所选 Codex 账号，保留模型和登录设置；工具授权仍由 Codex 管理。',
    'codexPlugins.saved': '已保存，新建 Codex 终端后生效。',
    'codexPlugins.lifecycle':
      '配置对新终端生效。禁用后不能新建内嵌 Worker；关闭 Host 前，请先通过它关闭 Worker。禁用不会卸载账号中的原生插件。',
  },
});

@Component({
  selector: 'app-codex-plugins-panel',
  imports: [FormsModule, TranslatePipe],
  template: ` <section class="plugins-panel">
    <h3>{{ 'codexPlugins.title' | t }}</h3>
    <h4>One Ring · 至尊魔戒</h4>
    <p>{{ 'codexPlugins.description' | t }}</p>
    @if (!plugins.desktop) {
      <p>{{ 'codexPlugins.desktop' | t }}</p>
    } @else {
      <fieldset [disabled]="busy() || !loaded()">
        <label class="enable"
          ><input type="checkbox" [(ngModel)]="enabled" />{{ 'codexPlugins.enable' | t }}</label
        >
        <label
          >{{ 'codexPlugins.source' | t
          }}<input class="input input-bordered" [(ngModel)]="sourcePath"
        /></label>
        <button type="button" class="btn btn-ghost btn-sm" (click)="browse()">
          {{ 'codexPlugins.browse' | t }}
        </button>
        <label
          >{{ 'codexPlugins.node' | t
          }}<input class="input input-bordered" [(ngModel)]="nodePath" placeholder="/usr/bin/node"
        /></label>
        <p>{{ 'codexPlugins.install' | t }}</p>
        <div class="actions">
          <button type="button" class="btn btn-ghost btn-sm" (click)="run(false)">
            {{ 'codexPlugins.check' | t }}
          </button>
          <button type="button" class="btn btn-primary btn-sm" (click)="run(true)">
            {{ 'codexPlugins.save' | t }}
          </button>
        </div>
      </fieldset>
      @if (notice()) {
        <p [attr.role]="failed() ? 'alert' : 'status'" [class.error]="failed()">{{ notice() }}</p>
      }
      @if (saved()) {
        <p role="status">{{ 'codexPlugins.saved' | t }}</p>
      }
      <p>{{ 'codexPlugins.lifecycle' | t }}</p>
    }
  </section>`,
  styles: `
    .plugins-panel {
      display: grid;
      gap: 16px;
      padding: 18px;
    }
    h3,
    h4,
    p {
      margin: 0;
    }
    p {
      font-size: 12px;
      line-height: 1.7;
      opacity: 0.8;
    }
    fieldset,
    label {
      display: grid;
      gap: 8px;
    }
    fieldset {
      padding: 0;
      border: 0;
      gap: 14px;
    }
    label {
      font-size: 12px;
    }
    .enable,
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    input:not([type='checkbox']) {
      width: 100%;
      font-family: monospace;
    }
    .error {
      color: #ef4444;
      opacity: 1;
    }
  `,
})
export class CodexPluginsPanelComponent {
  protected readonly plugins = inject(OneRingPluginService);
  private readonly picker = inject(DirectoryPickerService);
  protected readonly busy = signal(false);
  protected readonly loaded = signal(false);
  protected readonly notice = signal('');
  protected readonly failed = signal(false);
  protected readonly saved = signal(false);
  protected enabled = false;
  protected sourcePath = '';
  protected nodePath = '';

  constructor() {
    if (this.plugins.desktop) void this.load();
  }
  private async load(): Promise<void> {
    try {
      const { settings } = await this.plugins.get();
      this.enabled = settings.enabled;
      this.sourcePath = settings.sourcePath;
      this.nodePath = settings.nodePath;
      this.loaded.set(true);
    } catch (error) {
      this.failure(error);
    }
  }
  protected async browse(): Promise<void> {
    const path = await this.picker.select(this.sourcePath);
    if (path) this.sourcePath = path;
  }
  protected async run(saving: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.saved.set(false);
    const settings: OneRingSettings = {
      enabled: this.enabled,
      sourcePath: this.sourcePath.trim(),
      nodePath: this.nodePath.trim(),
    };
    try {
      const status: OneRingStatus = await (saving
        ? this.plugins.save(settings)
        : this.plugins.check(settings));
      this.notice.set(status.diagnostic);
      this.failed.set(!status.ready && (!saving || this.enabled));
      this.saved.set(saving);
    } catch (error) {
      this.failure(error);
    } finally {
      this.busy.set(false);
    }
  }
  private failure(error: unknown): void {
    this.failed.set(true);
    this.notice.set(error instanceof Error ? error.message : String(error));
  }
}
