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
    connect: ReturnType<typeof vi.fn>;
  };
  beforeEach(async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    service = {
      connection: vi.fn().mockResolvedValue(connection),
      doctor: vi.fn().mockResolvedValue({ version: '0.1.0', node: 'v24', platform: 'linux' }),
      list: vi.fn().mockResolvedValue([{ ...workflow, title: workflow.plan.title }]),
      status: vi.fn().mockResolvedValue(workflow),
      connect: vi.fn(),
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
    });
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
