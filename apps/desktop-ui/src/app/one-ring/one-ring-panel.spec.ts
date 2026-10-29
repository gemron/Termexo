import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OneRingPanelComponent } from './one-ring-panel';
import { OneRingService } from '../core/services/one-ring.service';
import {
  oneRingPhaseLabel,
  sameOneRingRoot,
  type OneRingWorkflow,
} from '../core/models/one-ring.models';

const connection = {
  pluginDirectory: 'C:\\one-ring',
  nodeCommand: 'node',
  stateDirectory: 'C:\\state',
};
const workflow: OneRingWorkflow = {
  id: 'workflow-1',
  root: 'C:\\project',
  phase: 'AWAITING_DELIVERY_APPROVAL',
  revision: 4,
  plan: {
    title: 'Fix retry',
    goal: 'Keep zero',
    version: 1,
    steps: ['Fix', 'Verify'],
    criteria: ['Accept zero'],
  },
  repairRound: 0,
  runs: [{ id: 'run', role: 'verifier', status: 'SUCCEEDED' }],
  verification: {
    outcome: 'PASS',
    summary: 'Verified',
    issues: [],
    criteria: [{ id: 'AC-1', status: 'PASS', evidence: 'node --test passed' }],
    checks: [],
  },
};
describe('One Ring integration panel', () => {
  let fixture: ComponentFixture<OneRingPanelComponent>;
  let service: {
    connection: ReturnType<typeof vi.fn>;
    doctor: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
  beforeEach(async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    service = {
      connection: vi.fn().mockResolvedValue(connection),
      doctor: vi.fn().mockResolvedValue({ version: '0.1.0', node: 'v24', platform: 'linux' }),
      list: vi.fn().mockResolvedValue([{ ...workflow, title: workflow.plan.title }]),
      status: vi.fn().mockResolvedValue(workflow),
    };
    await TestBed.configureTestingModule({
      imports: [OneRingPanelComponent],
      providers: [{ provide: OneRingService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(OneRingPanelComponent);
    fixture.componentRef.setInput('root', 'c:/project/');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });
  it('opens the built-in engine without any plugin, Node or state directory form', () => {
    expect(fixture.nativeElement.textContent).toContain('Termexo 内置编排');
    expect(fixture.nativeElement.querySelector('input[name="pluginDirectory"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="nodeCommand"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="stateDirectory"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('连接设置');
    expect(fixture.nativeElement.querySelector('#one-ring-goal')).not.toBeNull();
  });
  it('reports a missing bundled engine as an installation problem instead of asking for paths', async () => {
    service.connection.mockResolvedValue(null);
    fixture.destroy();
    fixture = TestBed.createComponent(OneRingPanelComponent);
    fixture.componentRef.setInput('root', 'c:/project/');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      '内置 One Ring',
    );
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('重试');
  });
  it('renders real verification evidence and retains the delivery approval phase after PASS', async () => {
    fixture.nativeElement.querySelector('.workflow').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('node --test passed');
    expect(fixture.nativeElement.querySelector('.phase').textContent).toContain('等待交付确认');
    expect(fixture.nativeElement.querySelector('.phase.complete')).toBeNull();
  });
  it('launches a coordinator request rather than writing approval or execution state', async () => {
    const emitted = vi.fn();
    fixture.componentInstance.coordinatorRequested.subscribe(emitted);
    const goal: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    goal.value = 'Fix retry handling';
    goal.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="one-ring-start"]').click();
    expect(emitted).toHaveBeenCalledWith({
      root: 'c:/project/',
      goal: 'Fix retry handling',
      workflowId: undefined,
      implementer: { cli: 'codex' },
    });
  });
  it('explains a reconciled interruption and does not offer to open a removed CLI', async () => {
    service.status.mockResolvedValue({ ...workflow, phase: 'BLOCKED', pendingStop: false,
      runs: [{ id: 'run', role: 'implementer', status: 'INTERRUPTED', terminalId: 'old-worker' }] });
    fixture.nativeElement.querySelector('.workflow').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('旧 Worker 已确认停止');
    expect(fixture.nativeElement.textContent).toContain('原 CLI 会话已关闭');
    expect(fixture.nativeElement.querySelector('.run button')).toBeNull();
    fixture.componentRef.setInput('terminals', [{ id: 'old-worker' }]);
    fixture.detectChanges();
    const emitted = vi.fn(); fixture.componentInstance.workerTerminalRequested.subscribe(emitted);
    fixture.nativeElement.querySelector('.run button').click();
    expect(emitted).toHaveBeenCalledWith('old-worker');
  });
  it('blocks unvalidated Windows execution while keeping workflow inspection available', async () => {
    service.doctor.mockResolvedValue({ version: '0.1.0', node: 'v24', platform: 'win32' });
    fixture.destroy();
    fixture = TestBed.createComponent(OneRingPanelComponent);
    fixture.componentRef.setInput('root', 'c:/project/');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="one-ring-platform-limit"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="one-ring-start"]').disabled).toBe(
      true,
    );
    expect(fixture.nativeElement.querySelector('.workflow')).not.toBeNull();
  });
  it('enables Windows execution only when the plugin declares the required lifecycle capability', async () => {
    service.doctor.mockResolvedValue({
      version: '0.1.0',
      node: 'v24',
      platform: 'win32',
      workerExecution: { supported: true, clis: ['codex'], lifecycle: 'windows-job-v1' },
    });
    fixture.destroy();
    fixture = TestBed.createComponent(OneRingPanelComponent);
    fixture.componentRef.setInput('root', 'c:/project/');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance['goal'].set('Fix retry handling');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="one-ring-platform-limit"]'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="one-ring-start"]').disabled).toBe(
      false,
    );
  });
  it.each([
    { supported: false, clis: ['codex'], lifecycle: 'windows-job-v1' },
    { supported: true, clis: ['pi'], lifecycle: 'windows-job-v1' },
    { supported: true, clis: ['codex'], lifecycle: 'unknown' },
  ])('keeps unsupported Windows capability declarations disabled: %j', async (workerExecution) => {
    service.doctor.mockResolvedValue({
      version: '0.1.0',
      node: 'v24',
      platform: 'win32',
      workerExecution,
    });
    fixture.destroy();
    fixture = TestBed.createComponent(OneRingPanelComponent);
    fixture.componentRef.setInput('root', 'c:/project/');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance['goal'].set('Fix retry handling');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="one-ring-start"]').disabled).toBe(
      true,
    );
  });
  it('filters workflows by the current workspace and clears previous selection', async () => {
    fixture.nativeElement.querySelector('.workflow').click();
    await fixture.whenStable();
    fixture.componentRef.setInput('root', '/another/project');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.workflow')).toBeNull();
    expect(fixture.nativeElement.querySelector('.phase')).toBeNull();
  });
  it('compares Windows and POSIX project paths correctly and keeps unknown phases visible', () => {
    expect(sameOneRingRoot('C:\\Work\\Project', 'c:/work/project/')).toBe(true);
    expect(sameOneRingRoot('/Work/Project', '/work/project')).toBe(false);
    expect(oneRingPhaseLabel('FUTURE_PHASE')).toBe('FUTURE_PHASE');
  });
});
