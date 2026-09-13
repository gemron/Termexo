import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HandoffDialogComponent } from './handoff-dialog';
import { I18nService } from '../core/i18n/i18n.service';
import type { HandoffPackage, HandoffRecord } from '../core/models/handoff';

const PACKAGE: HandoffPackage = {
  format: 'termexo-handoff',
  version: 1,
  id: 'handoff-1',
  title: 'Review',
  createdAt: 1,
  workspaceId: 'workspace-1',
  workspaceName: 'Project',
  projectPath: 'D:/project',
  scope: 'workspace',
  task: 'Finish review',
  summary: 'Review in progress',
  nextAction: 'Run tests',
  completed: [],
  pending: [],
  decisions: [],
  changedFiles: [],
  gitBranch: '',
  gitStatus: '',
  gitDiff: '',
  recentCommits: [],
  validation: [],
  risks: [],
  recentPrompts: [],
  terminalOutput: '',
  sources: [],
  tokenBudget: 8000,
  estimatedTokens: 100,
  redactions: 0,
  truncated: false,
};
const RECORD: HandoffRecord = {
  id: 'handoff-2',
  workspaceId: 'workspace-1',
  title: 'Other handoff',
  packageJson: JSON.stringify({ ...PACKAGE, id: 'handoff-2' }),
  createdAt: 1,
  updatedAt: 1,
};

describe('handoff editing', () => {
  let fixture: ComponentFixture<HandoffDialogComponent>;
  let root: HTMLElement;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HandoffDialogComponent] }).compileComponents();
    TestBed.inject(I18nService).setPreference('en');
    fixture = TestBed.createComponent(HandoffDialogComponent);
    fixture.componentRef.setInput('records', [RECORD]);
    fixture.componentRef.setInput('terminals', []);
    fixture.componentRef.setInput('preview', PACKAGE);
    root = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });
  async function edit(value: string) {
    const input = root.querySelector('textarea')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  function click(selector: string) {
    root.querySelector<HTMLButtonElement>(selector)!.click();
    fixture.detectChanges();
  }

  it('protects edits on close and only discards after confirmation', async () => {
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    await edit('Updated goal');
    click('header button');
    expect(cancelled).not.toHaveBeenCalled();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('unsaved');
    click('.handoff-unsaved button');
    expect(root.querySelector('textarea')!.value).toBe('Updated goal');
    click('header button');
    click('.handoff-unsaved button:last-child');
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('guards history switching and import, and does not switch when editing continues', async () => {
    const selected = vi.fn();
    const imported = vi.fn();
    fixture.componentInstance.recordSelected.subscribe(selected);
    fixture.componentInstance.imported.subscribe(imported);
    await edit('Updated goal');
    click('.record-main');
    expect(selected).not.toHaveBeenCalled();
    click('.handoff-unsaved button');
    click('.history-card .section-title button');
    expect(imported).not.toHaveBeenCalled();
    click('.handoff-unsaved button');
    click('.record-main');
    click('.handoff-unsaved button:last-child');
    expect(selected).toHaveBeenCalledWith(RECORD);
    expect(imported).not.toHaveBeenCalled();
  });

  it('emits sanitized edits and remains dirty until a successful preview update', async () => {
    let saved: HandoffPackage | undefined;
    fixture.componentInstance.saved.subscribe((value) => (saved = value));
    await edit('Fix api_key=abcdefghijklmnop');
    click('.save-changes');
    expect(saved?.task).not.toContain('abcdefghijklmnop');
    expect(saved?.redactions).toBeGreaterThan(0);
    expect(PACKAGE.task).toBe('Finish review');
    expect(root.querySelector<HTMLButtonElement>('.save-changes')!.disabled).toBe(false);
    fixture.componentRef.setInput('preview', saved);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector<HTMLButtonElement>('.save-changes')!.disabled).toBe(true);
    expect(root.querySelector('textarea')!.value).toBe(saved!.task);
  });

  it('blocks blank saves and locks inputs and dismissal while saving', async () => {
    await edit('   ');
    expect(root.querySelector<HTMLButtonElement>('.save-changes')!.disabled).toBe(true);
    await edit('Updated goal');
    click('header button');
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('textarea')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.record-main')!.disabled).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>('.handoff-unsaved button:last-child')!.disabled,
    ).toBe(true);
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    root.querySelector('.backdrop')!.dispatchEvent(new MouseEvent('mousedown'));
    expect(cancelled).not.toHaveBeenCalled();
  });
});
