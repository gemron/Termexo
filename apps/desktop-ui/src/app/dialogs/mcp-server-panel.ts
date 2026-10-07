import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import type { McpServerStatus } from '../core/models/mcp-server.models';
import { McpServerService } from '../core/services/mcp-server.service';
import { runtimeMode } from '../core/services/tauri-runtime';

@Component({
  selector: 'app-mcp-server-panel',
  imports: [FormsModule, TranslatePipe],
  template: `
    <section class="mcp-panel">
      <header>
        <h3>{{ 'mcpServer.title' | t }}</h3>
        <p>{{ 'mcpServer.description' | t }}</p>
      </header>
      <section class="quick-start">
        <h4>{{ 'mcpServer.quickStart' | t }}</h4>
        <ol>
          <li>{{ 'mcpServer.stepEnable' | t }}</li>
          <li>{{ 'mcpServer.stepLaunch' | t }}</li>
          <li>{{ 'mcpServer.stepAsk' | t }}</li>
        </ol>
        <p class="hint">{{ 'mcpServer.keepOpen' | t }}</p>
      </section>
      @if (!desktop) {
        <p>{{ 'mcpServer.desktopOnly' | t }}</p>
      } @else {
        @if (status(); as current) {
          <span class="mcp-server-status" role="status" [class.running]="current.running">
            {{ (current.running ? 'mcpServer.running' : 'mcpServer.stopped') | t }}
          </span>
          <p class="hint">{{ 'mcpServer.statusHint' | t }}</p>
          <fieldset [disabled]="busy()">
            <label class="check"
              ><input type="checkbox" [(ngModel)]="enabled" />{{ 'mcpServer.enabled' | t }}</label
            >
            <label class="check"
              ><input type="checkbox" [(ngModel)]="autoConnectAgents" />{{
                'mcpServer.autoConnectAgents' | t
              }}</label
            >
            <p class="hint">{{ 'mcpServer.autoConnectHint' | t }}</p>
            <h4>{{ 'mcpServer.permissions' | t }}</h4>
            <label class="check"
              ><input type="checkbox" [(ngModel)]="terminalAccess" />{{
                'mcpServer.terminals' | t
              }}</label
            >
            <label class="check"
              ><input type="checkbox" [(ngModel)]="taskAccess" />{{ 'mcpServer.tasks' | t }}</label
            >
            <label class="check"
              ><input type="checkbox" [(ngModel)]="settingsAccess" />{{
                'mcpServer.settings' | t
              }}</label
            >
            <p class="hint">{{ 'mcpServer.accessHint' | t }}</p>
            <button class="btn btn-primary btn-sm" type="button" (click)="apply()">
              {{ 'mcpServer.apply' | t }}
            </button>
          </fieldset>
          <section class="examples">
            <h4>{{ 'mcpServer.tryTitle' | t }}</h4>
            <p class="hint">{{ 'mcpServer.tryHint' | t }}</p>
            <blockquote>{{ 'mcpServer.firstPrompt' | t }}</blockquote>
            <button class="btn btn-ghost btn-sm" type="button" (click)="copyPrompt()">
              {{ 'mcpServer.copyPrompt' | t }}
            </button>
            @if (copied() === 'prompt') {
              <span role="status">{{ 'mcpServer.copied' | t }}</span>
            }
            <p class="hint">{{ 'mcpServer.successHint' | t }}</p>
            <h4>{{ 'mcpServer.moreExamples' | t }}</h4>
            <ul>
              <li>{{ 'mcpServer.terminalExample' | t }}</li>
              <li>{{ 'mcpServer.taskExample' | t }}</li>
              <li>{{ 'mcpServer.settingsExample' | t }}</li>
            </ul>
          </section>
          <details class="help">
            <summary>{{ 'mcpServer.helpTitle' | t }}</summary>
            <ul>
              <li>{{ 'mcpServer.helpConnection' | t }}</li>
              <li>{{ 'mcpServer.helpPermission' | t }}</li>
              <li>{{ 'mcpServer.helpLogin' | t }}</li>
              <li>{{ 'mcpServer.helpWaiting' | t }}</li>
            </ul>
          </details>
          <details class="advanced">
            <summary>{{ 'mcpServer.advancedTitle' | t }}</summary>
            <section class="connection">
              <p class="hint">{{ 'mcpServer.manualHint' | t }}</p>
              <label class="port"
                >{{ 'mcpServer.port' | t }}
                <input
                  class="input input-bordered input-sm"
                  type="number"
                  min="1"
                  max="65535"
                  [disabled]="busy()"
                  [(ngModel)]="port"
                />
              </label>
              <p class="hint">{{ 'mcpServer.portHint' | t }}</p>
              <h4>{{ 'mcpServer.endpoint' | t }}</h4>
              <code>{{ current.url }}</code>
              @if (current.token) {
                <h4>{{ 'mcpServer.token' | t }}</h4>
                <code class="token">{{
                  showToken() ? current.token : '••••••••••••••••••••••••'
                }}</code>
                <div class="actions">
                  <button
                    class="btn btn-ghost btn-sm"
                    type="button"
                    (click)="showToken.set(!showToken())"
                  >
                    {{ (showToken() ? 'mcpServer.hideToken' : 'mcpServer.showToken') | t }}
                  </button>
                  <button class="btn btn-ghost btn-sm" type="button" (click)="copy(current.token)">
                    {{ 'mcpServer.copyToken' | t }}
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    type="button"
                    [disabled]="busy()"
                    (click)="rotate()"
                  >
                    {{ 'mcpServer.rotateToken' | t }}
                  </button>
                </div>
                <p class="hint">{{ 'mcpServer.rotateHint' | t }}</p>
                <h4>{{ 'mcpServer.config' | t }}</h4>
                <p class="hint">{{ 'mcpServer.configHint' | t }}</p>
                <pre>{{ jsonConfig(false) }}</pre>
                <div class="actions">
                  <button
                    class="btn btn-secondary btn-sm"
                    type="button"
                    (click)="copy(jsonConfig(true))"
                  >
                    {{ 'mcpServer.copyJson' | t }}
                  </button>
                  <button
                    class="btn btn-secondary btn-sm"
                    type="button"
                    (click)="copy(tomlConfig())"
                  >
                    {{ 'mcpServer.copyCodex' | t }}
                  </button>
                </div>
              }
              <p class="hint">{{ 'mcpServer.localOnly' | t }}</p>
              <p class="hint">{{ 'mcpServer.globalConfigHint' | t }}</p>
            </section>
          </details>
          @if (copied() === 'connection') {
            <span role="status">{{ 'mcpServer.copied' | t }}</span>
          }
          @if (current.error) {
            <p class="error" role="alert">{{ current.error }}</p>
          }
        }
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .mcp-panel {
      padding: 20px;
      display: grid;
      gap: 16px;
    }
    h3,
    h4,
    p {
      margin: 0;
    }
    header,
    fieldset,
    .connection,
    .quick-start,
    .examples {
      display: grid;
      gap: 12px;
    }
    .quick-start,
    .examples {
      padding: 16px;
      border: 1px solid #8883;
      border-radius: 10px;
      background: #8881;
    }
    ol,
    ul {
      margin: 0;
      padding-left: 22px;
      font-size: 13px;
      line-height: 1.7;
    }
    li + li {
      margin-top: 8px;
    }
    ol {
      list-style: decimal;
    }
    ul {
      list-style: disc;
    }
    blockquote {
      margin: 0;
      padding-left: 12px;
      border-left: 3px solid #58c7a0;
      font-size: 14px;
      line-height: 1.7;
      overflow-wrap: anywhere;
    }
    summary {
      cursor: pointer;
      font-size: 13px;
      line-height: 1.6;
    }
    details > section,
    details > ul {
      margin-top: 12px;
    }
    .examples > button {
      justify-self: start;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
    }
    .check {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .port {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .port input {
      width: 110px;
    }
    .hint,
    header p {
      font-size: 12px;
      opacity: 0.7;
      line-height: 1.6;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .mcp-server-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      line-height: 1.5;
      opacity: 0.7;
    }
    .mcp-server-status::before {
      content: '';
      flex: 0 0 8px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    .mcp-server-status.running {
      color: #58c7a0;
      opacity: 1;
    }
    code,
    pre {
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    pre {
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      background: #0002;
      white-space: pre-wrap;
    }
    .token {
      user-select: all;
    }
    .error {
      color: #ef7890;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    fieldset > button {
      justify-self: start;
    }
  `,
})
export class McpServerPanelComponent {
  private readonly server = inject(McpServerService);
  private readonly i18n = inject(I18nService);
  protected readonly desktop = runtimeMode() === 'desktop';
  protected readonly status = signal<McpServerStatus | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showToken = signal(false);
  protected readonly copied = signal<'prompt' | 'connection' | null>(null);
  protected enabled = false;
  protected autoConnectAgents = true;
  protected port = 7421;
  protected terminalAccess = true;
  protected taskAccess = true;
  protected settingsAccess = false;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copiedTimer));
    if (this.desktop) void this.run(() => this.server.getStatus());
  }

  protected async apply(): Promise<void> {
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      this.error.set(this.i18n.t('mcpServer.invalidPort'));
      return;
    }
    await this.run(() =>
      this.server.updateSettings({
        enabled: this.enabled,
        autoConnectAgents: this.autoConnectAgents,
        port: this.port,
        terminalAccess: this.terminalAccess,
        taskAccess: this.taskAccess,
        settingsAccess: this.settingsAccess,
      }),
    );
  }

  protected async rotate(): Promise<void> {
    await this.run(() => this.server.regenerateToken());
    this.showToken.set(false);
  }

  protected jsonConfig(includeToken: boolean): string {
    const status = this.status();
    return JSON.stringify(
      {
        mcpServers: {
          termexo: {
            type: 'http',
            url: status?.url,
            headers: { Authorization: `Bearer ${includeToken ? status?.token : '<TOKEN>'}` },
          },
        },
      },
      null,
      2,
    );
  }

  protected tomlConfig(): string {
    const status = this.status();
    return `[mcp_servers.termexo]\nurl = ${JSON.stringify(status?.url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${status?.token}`)} }\n`;
  }

  protected async copy(
    value: string,
    target: 'prompt' | 'connection' = 'connection',
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(target);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(null), 2000);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  protected copyPrompt(): Promise<void> {
    return this.copy(this.i18n.t('mcpServer.firstPrompt'), 'prompt');
  }

  private async run(operation: () => Promise<McpServerStatus>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const status = await operation();
      this.status.set(status);
      Object.assign(this, status.settings);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}
