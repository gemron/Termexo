import {
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  PendingTasks,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OneRingService } from '../core/services/one-ring.service';
import { runtimeMode } from '../core/services/tauri-runtime';
import { invoke } from '../core/services/backend-bridge';
import {
  oneRingPhaseLabel,
  sameOneRingRoot,
  type OneRingCoordinatorRequest,
  type OneRingDoctor,
  type OneRingSummary,
  type OneRingWorkflow,
} from '../core/models/one-ring.models';

@Component({
  selector: 'app-one-ring-panel',
  imports: [FormsModule],
  templateUrl: './one-ring-panel.html',
  styleUrl: './one-ring-panel.scss',
})
export class OneRingPanelComponent implements OnDestroy {
  private readonly service = inject(OneRingService);
  private readonly pendingTasks = inject(PendingTasks);
  readonly root = input.required<string>();
  readonly terminals = input<readonly { id: string }[]>([]);
  readonly coordinatorRequested = output<OneRingCoordinatorRequest>();
  readonly terminalRequested = output<void>();
  readonly workerTerminalRequested = output<string>();
  protected readonly mode = runtimeMode();
  protected readonly phaseLabel = oneRingPhaseLabel;
  protected readonly connected = signal(false);
  protected readonly doctor = signal<OneRingDoctor | null>(null);
  protected readonly workflows = signal<OneRingSummary[]>([]);
  protected readonly selected = signal<OneRingWorkflow | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly goal = signal('');
  protected readonly implementerCli = signal<'codex' | 'opencode'>('codex');
  protected readonly implementerModel = signal('');
  protected readonly openCodeModels = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly refreshedAt = signal('');
  protected readonly visibleWorkflows = computed(() =>
    this.workflows().filter((w) => sameOneRingRoot(w.root, this.root())),
  );
  protected readonly executionSupported = computed(() => {
    const health = this.doctor();
    if (health?.platform === 'linux') return health.workerExecution?.supported ?? true;
    return (
      health?.platform === 'win32' &&
      health.workerExecution?.supported === true &&
      health.workerExecution.lifecycle === 'windows-job-v1' &&
      health.workerExecution.clis.includes('codex')
    );
  });
  private disposed = false;
  private generation = 0;
  private observedRoot: string | undefined;
  private readonly poll = setInterval(() => {
    if (this.connected() && !this.busy()) void this.refresh();
  }, 5000);

  constructor() {
    effect(() => {
      const root = this.root();
      if (this.observedRoot !== undefined && this.observedRoot !== root) {
        this.generation++;
        this.selectedId.set(null);
        this.selected.set(null);
      }
      this.observedRoot = root;
    });
    void this.pendingTasks.run(() => this.load());
  }

  ngOnDestroy(): void {
    this.disposed = true;
    this.generation++;
    clearInterval(this.poll);
  }
  protected async reload(): Promise<void> {
    if (this.connected()) await this.refresh();
    else await this.load();
  }
  private async load(): Promise<void> {
    if (this.mode === 'preview') return;
    this.busy.set(true);
    this.error.set('');
    try {
      const connection = await this.service.connection();
      if (this.disposed) return;
      if (connection) {
        this.connected.set(true);
      } else {
        this.error.set('内置 One Ring 引擎尚未就绪，请检查 Termexo 安装或重试。');
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy.set(false);
    }
    if (this.connected() && !this.disposed) await this.refresh();
  }
  protected async refresh(): Promise<void> {
    if (this.busy() || !this.connected() || this.disposed) return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const [doctor, workflows] = await Promise.all([
        this.doctor() ?? this.service.doctor(),
        this.service.list(),
      ]);
      if (this.disposed || generation !== this.generation) return;
      this.doctor.set(doctor);
      this.workflows.set(workflows);
      const id = this.selectedId();
      if (id) {
        const workflow = await this.service.status(id);
        if (!this.disposed && generation === this.generation && id === this.selectedId())
          this.selected.set(workflow);
      }
      this.refreshedAt.set(new Date().toLocaleTimeString());
    } catch (error) {
      if (generation === this.generation) {
        this.doctor.set(null);
        this.fail(error);
      }
    } finally {
      this.busy.set(false);
    }
  }
  protected async select(id: string): Promise<void> {
    this.selectedId.set(id);
    this.selected.set(null);
    const generation = this.generation;
    try {
      const workflow = await this.service.status(id);
      if (!this.disposed && generation === this.generation && this.selectedId() === id)
        this.selected.set(workflow);
    } catch (error) {
      if (this.selectedId() === id) this.fail(error);
    }
  }
  protected terminalAvailable(id: string): boolean {
    return this.terminals().some((terminal) => terminal.id === id);
  }
  protected async chooseImplementer(cli: 'codex' | 'opencode'): Promise<void> {
    this.implementerCli.set(cli); this.implementerModel.set(''); this.openCodeModels.set([]);
    if (cli === 'opencode' && this.mode !== 'preview') {
      try { this.openCodeModels.set(await invoke<string[]>('list_opencode_worker_models', { workingDirectory: this.root() })); }
      catch { /* The coordinator must report an unavailable CLI/model before approval. */ }
    }
  }
  protected start(workflow?: OneRingWorkflow): void {
    if (!this.connected() || this.busy() || this.error() || !this.executionSupported()) return;
    if (!workflow && !this.goal().trim()) return;
    this.coordinatorRequested.emit({
      root: this.root(),
      goal: workflow?.plan.goal ?? this.goal().trim(),
      workflowId: workflow?.id,
      ...(workflow?.coordinatorTerminalId ? { coordinatorTerminalId: workflow.coordinatorTerminalId } : {}),
      ...(!workflow ? { implementer: { cli: this.implementerCli(), ...(this.implementerModel().trim() ? { model: this.implementerModel().trim() } : {}) } } : {}),
    });
  }
  private fail(error: unknown): void {
    if (!this.disposed) this.error.set(error instanceof Error ? error.message : String(error));
  }
}
