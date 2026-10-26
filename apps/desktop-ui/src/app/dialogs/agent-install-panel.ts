import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { registerAgentInstallTranslations } from '../core/i18n/agent-install.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  type AgentInstallation,
  type CliInstaller,
  type CliOperationRequest,
  type ManagedAgentType,
  MANAGED_AGENT_INSTALLERS,
} from '../core/models/agent.models';
import { AGENT_ICONS, AGENT_LABELS } from '../core/models/workspace.models';
import { AgentInstallService } from '../core/services/agent-install.service';
import { AgentService } from '../core/services/agent.service';
import { hasBackend } from '../core/services/tauri-runtime';
import { ExternalLinkDirective } from '../shared/external-link.directive';
import { IconComponent } from '../shared/icon/icon';

registerAgentInstallTranslations();

const AGENTS = (['claude', 'codex', 'opencode', 'pi', 'grok', 'antigravity'] as const).map(
  (type) => ({ type, name: AGENT_LABELS[type] }),
);

@Component({
  selector: 'app-agent-install-panel',
  imports: [FormsModule, TranslatePipe, IconComponent, ExternalLinkDirective],
  templateUrl: './agent-install-panel.html',
  styleUrl: './agent-install-panel.scss',
})
export class AgentInstallPanelComponent {
  readonly initialAgent = input<ManagedAgentType | ''>('');
  readonly workspaceId = input('');
  readonly networkRequested = output<void>();
  protected readonly flow = inject(AgentInstallService);
  private readonly agents = inject(AgentService);
  private readonly i18n = inject(I18nService);
  protected readonly catalog = AGENTS;
  protected readonly icons = AGENT_ICONS;
  protected readonly available = hasBackend();
  protected readonly selected = signal<ManagedAgentType>('claude');
  protected readonly installer = signal<CliInstaller | 'auto'>('auto');
  protected readonly version = signal('');
  protected readonly linkError = signal<string | null>(null);
  protected readonly busy = computed(() => this.flow.stage() !== 'idle');
  protected readonly selectedName = computed(
    () => AGENTS.find((agent) => agent.type === this.selected())!.name,
  );
  protected readonly methods = computed(() => MANAGED_AGENT_INSTALLERS[this.selected()]);
  protected readonly installations = computed<Record<ManagedAgentType, AgentInstallation | null>>(
    () => ({
      claude: this.agents.installation(),
      codex: this.agents.codexInstallation(),
      opencode: this.agents.openCodeInstallation(),
      pi: this.agents.piInstallation(),
      grok: this.agents.grokInstallation(),
      antigravity: this.agents.antigravityInstallation(),
    }),
  );
  protected readonly installation = computed(() => this.installations()[this.selected()]);
  protected readonly request = computed<CliOperationRequest>(() => ({
    agentType: this.selected(),
    installer: this.installer() === 'auto' ? undefined : (this.installer() as CliInstaller),
    targetVersion: this.installer() === 'npm' ? this.version().trim() || 'latest' : undefined,
    workspaceId: this.workspaceId() || undefined,
  }));
  protected readonly matches = computed(() => this.flow.matches(this.request()));
  protected readonly plan = computed(() => (this.matches() ? this.flow.plan() : null));
  protected readonly result = computed(() => (this.matches() ? this.flow.result() : null));
  protected readonly error = computed(() => (this.matches() ? this.flow.error() : null));
  protected readonly failed = computed(() => !!this.error() || this.result()?.success === false);
  protected readonly needsNode = computed(
    () => this.plan()?.installer === 'npm' && !this.plan()?.ready,
  );
  protected readonly currentLabel = computed(() =>
    this.i18n.t(
      this.plan()?.targetVersion && this.plan()?.targetVersion !== 'latest'
        ? 'install.selectedCurrent'
        : 'install.current',
    ),
  );
  protected readonly primaryLabel = computed(() => {
    if (this.busy())
      return this.i18n.t(
        this.flow.stage() === 'checking' ? 'install.checking' : 'install.installing',
      );
    if (this.result()?.success) return this.i18n.t('install.check');
    if (this.error() && !this.result()) return this.i18n.t('install.check');
    if (this.plan()?.upToDate) return this.currentLabel();
    if (!this.installation()?.installed) return this.i18n.t('install.latest');
    if (this.selected() === 'antigravity' || this.plan()?.installer === 'script')
      return this.i18n.t('install.nativeUpdate');
    return this.i18n.t(this.plan()?.ready ? 'install.update' : 'install.check');
  });
  protected readonly failureHelp = computed(() => {
    const result = this.result();
    const detail = [this.error(), result?.diagnostic, result?.stderr, result?.stdout].join(' ');
    if (
      /ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|proxy|network|fetch failed|连接|网络|下载|超时/i.test(
        detail,
      )
    )
      return this.i18n.t('install.network');
    if (/EACCES|EPERM|EBUSY|access.*denied|permission denied|正在使用|拒绝访问|权限/i.test(detail))
      return this.i18n.t('install.permissions');
    return this.i18n.t('install.genericError');
  });
  private initialized = false;

  constructor() {
    effect(() => {
      const initial = this.initialAgent();
      untracked(() => {
        if (this.initialized) return;
        this.initialized = true;
        const pending = this.flow.request()?.agentType;
        this.selected.set(this.busy() ? (pending ?? 'claude') : initial || pending || 'claude');
        const previous = this.flow.request();
        if (previous?.agentType === this.selected()) {
          this.installer.set(previous.installer ?? 'auto');
          this.version.set(
            previous.targetVersion === 'latest' ? '' : (previous.targetVersion ?? ''),
          );
        }
      });
    });
  }

  protected select(type: ManagedAgentType): void {
    if (this.busy()) return;
    this.selected.set(type);
    this.installer.set('auto');
    this.version.set('');
    this.linkError.set(null);
  }

  protected status(type: ManagedAgentType): string {
    const installation = this.installations()[type];
    if (!installation && this.agents.detectionStates()[type]?.status === 'checking')
      return this.i18n.t('install.checkingStatus');
    if (!installation?.installed) return this.i18n.t('install.missing');
    return this.i18n.t(installation.healthy ? 'install.ready' : 'install.needsRepair');
  }

  protected async primary(): Promise<void> {
    if (!this.available || this.busy() || (this.plan()?.upToDate && !this.result())) return;
    const direct =
      !this.installation()?.installed ||
      this.selected() === 'antigravity' ||
      (!!this.plan()?.ready && !this.result() && !this.error());
    if (direct) await this.flow.install(this.request());
    else await this.flow.check(this.request());
  }

  protected async refresh(): Promise<void> {
    if (this.busy()) return;
    try {
      await this.agents.refreshInstallations();
      if (this.matches() && this.plan() && !this.plan()?.ready)
        await this.flow.check(this.request());
    } catch (error) {
      this.linkError.set(error instanceof Error ? error.message : String(error));
    }
  }
}
