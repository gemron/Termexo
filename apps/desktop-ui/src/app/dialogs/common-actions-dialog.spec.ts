import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonActionsDialogComponent } from './common-actions-dialog';
import { CommonActionsService } from '../core/services/common-actions.service';

describe('common action review and editing', () => {
  const actions = {
    reviews: signal<Record<string, unknown>>({}),
    busy: signal(new Set()),
    save: vi.fn(),
    run: vi.fn(),
    confirm: vi.fn(),
    editSuggestion: vi.fn(),
    discard: vi.fn(),
    stop: vi.fn(),
    remove: vi.fn(),
  };
  beforeEach(() => {
    actions.reviews.set({});
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: CommonActionsService, useValue: actions }],
    });
  });
  function create() {
    const fixture = TestBed.createComponent(CommonActionsDialogComponent);
    fixture.componentRef.setInput('workspace', {
      id: 'w',
      name: '项目',
      projectPath: 'D:/project',
      terminals: [],
      commonActions: [
        { id: 'a', name: '前端', command: 'npm run dev', workingDirectory: 'D:/project' },
      ],
    });
    fixture.detectChanges();
    return fixture;
  }
  it('opens and focuses the editor above saved operations without saving or running', async () => {
    const fixture = create();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent?.trim() === '编辑')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const editor = fixture.nativeElement.querySelector('.editor') as HTMLElement;
    const saved = fixture.nativeElement.querySelector('.saved-action') as HTMLElement;
    expect(editor.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(editor.querySelector('input'));
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.run).not.toHaveBeenCalled();
  });
  it('disables confirmation when every suggestion is unchecked', () => {
    actions.reviews.set({
      w: {
        waiting: false,
        suggestions: [
          {
            id: 's',
            selected: false,
            name: '服务',
            command: 'run',
            workingDirectory: 'D:/project',
          },
        ],
      },
    });
    const fixture = create();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    const confirm = buttons.find((b) => b.textContent?.includes('确认添加'))!;
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toContain('0 项');
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it('keeps launch controls on each compact operation and stays open after starting one', async () => {
    const fixture = create();
    const closed = vi.fn();
    const terminal = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.terminalRequested.subscribe(terminal);
    const card = fixture.nativeElement.querySelector('.saved-action') as HTMLElement;
    const labels = [...card.querySelectorAll('button')].map((button) => button.textContent?.trim());
    expect(labels).toEqual(['启动', '停止', '重启', '控制台', '编辑', '移除']);
    actions.run.mockResolvedValue('terminal-1');
    await (fixture.componentInstance as unknown as { run(id: string): Promise<void> }).run('a');
    fixture.detectChanges();
    expect(actions.run).toHaveBeenCalledWith('w', 'a', false);
    expect(closed).not.toHaveBeenCalled();
    expect(terminal).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('已启动');
  });

  it('automatically displays results after waiting and opens editing only for the selected suggestion', async () => {
    actions.reviews.set({ w: { requestId: 'r', terminalId: 'agent', waiting: true, suggestions: [] } });
    const fixture = create();
    const tabs = () => [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    tabs()[0].click();
    fixture.detectChanges();
    actions.reviews.set({ w: { requestId: 'r', waiting: false, suggestions: [
      { id: 's', name: '测试', command: 'npm test', workingDirectory: 'D:/project', description: '', selected: true },
    ] } });
    fixture.detectChanges();
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.querySelectorAll('.suggestion input:not([type="checkbox"])')).toHaveLength(0);
    fixture.nativeElement.querySelector('.suggestion button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const command = fixture.nativeElement.querySelector('.editor input[name="command"]') as HTMLInputElement;
    command.value = 'pnpm test';
    command.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('.editor').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(actions.editSuggestion).toHaveBeenCalledWith('w', 's', expect.objectContaining({ command: 'pnpm test' }));
    expect(actions.save).not.toHaveBeenCalled();
  });
});
