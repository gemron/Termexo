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
      @if (!desktop) {
        <p>{{ 'mcpServer.desktopOnly' | t }}</p>
      } @else {
        @if (status(); as current) {
          <span class="status" [class.running]="current.running">
            {{ (current.running ? 'mcpServer.running' : 'mcpServer.stopped') | t }}
          </span>
          <fieldset [disabled]="busy()">
            <label class="check"
              ><input type="checkbox" [(ngModel)]="enabled" />{{ 'mcpServer.enabled' | t }}</label
            >
            <label class="port"
              >{{ 'mcpServer.port' | t }}
              <input
                class="input input-bordered input-sm"
                type="number"
                min="1"
                max="65535"
                [(ngModel)]="port"
              />
            </label>
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
          <section class="connection">
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
                <button class="btn btn-secondary btn-sm" type="button" (click)="copy(tomlConfig())">
                  {{ 'mcpServer.copyCodex' | t }}
                </button>
                @if (copied()) {
                  <span role="status">{{ 'mcpServer.copied' | t }}</span>
                }
              </div>
            }
            <p class="hint">{{ 'mcpServer.localOnly' | t }}</p>
          </section>
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
    .connection {
      display: grid;
      gap: 12px;
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
    .status {
      font-size: 12px;
      opacity: 0.7;
    }
    .running {
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
  protected readonly copied = signal(false);
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

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
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
