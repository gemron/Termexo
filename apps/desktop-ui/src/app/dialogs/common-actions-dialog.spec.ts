import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonActionsDialogComponent } from './common-actions-dialog';
import { CommonActionsService } from '../core/services/common-actions.service';
import type { CommonAction, Workspace } from '../core/models/workspace.models';
import { DirectoryPickerService } from '../core/services/directory-picker.service';

describe('common action review and editing', () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn().mockResolvedValue(undefined);
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
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    actions.reviews.set({});
    actions.busy.set(new Set());
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: CommonActionsService, useValue: actions }],
    });
  });
  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  function create(patch: Partial<Workspace> = {}) {
    const fixture = TestBed.createComponent(CommonActionsDialogComponent);
    fixture.componentRef.setInput('workspace', {
      id: 'w',
      name: '项目',
      projectPath: 'D:/project',
      terminals: [],
      commonActions: [
        { id: 'a', name: '前端', command: 'npm run dev', workingDirectory: 'D:/project' },
      ],
      ...patch,
    });
    fixture.detectChanges();
    return fixture;
  }

  it('shows AI-provided directories and environment values for review and pre-fills them when editing', async () => {
    actions.reviews.set({ w: { waiting: false, suggestions: [
      { id: 'ai-web', name: 'Web', command: 'pnpm dev', workingDirectory: 'D:/project/apps/web',
        environment: { NODE_ENV: 'development', PORT: '4300', EMPTY: '' }, description: 'README and package.json', selected: true },
      { id: 'ai-build', name: 'Build', command: 'pnpm build', workingDirectory: 'D:/project', environment: {}, selected: true },
    ] } });
    const fixture = create();
    const suggestions = fixture.nativeElement.querySelectorAll('.suggestion') as NodeListOf<HTMLElement>;
    expect(suggestions[0].textContent).toContain('工作目录：D:/project/apps/web');
    expect(suggestions[0].querySelector('summary')?.textContent).toContain('3 个环境变量');
    expect(suggestions[0].querySelector('dl')?.textContent).toContain('development');
    expect(suggestions[0].querySelector('dl')?.textContent).toContain('4300');
    expect(suggestions[0].querySelector('dl')?.textContent).toContain('(空值)');
    expect(suggestions[1].textContent).toContain('继承主机环境');
    suggestions[0].querySelector('button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[name="directory"]').value).toBe('D:/project/apps/web');
    expect(fixture.nativeElement.querySelector('[aria-label="环境变量名 1"]').value).toBe('NODE_ENV');
    expect(fixture.nativeElement.querySelector('[aria-label="环境变量值 2"]').value).toBe('4300');
    fixture.nativeElement.querySelector('form.editor').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(actions.editSuggestion).toHaveBeenCalledWith('w', 'ai-web', expect.objectContaining({
      workingDirectory: 'D:/project/apps/web', environment: { NODE_ENV: 'development', PORT: '4300', EMPTY: '' },
    }));
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.run).not.toHaveBeenCalled();
  });

  it('edits environment key/value rows and saves them with the selected working directory', async () => {
    const original = { id: 'a', name: 'Dev', command: 'npm run dev', workingDirectory: 'D:/project',
      description: '', environment: { NODE_ENV: 'development' } };
    const fixture = create({ commonActions: [original] });
    expect(fixture.nativeElement.querySelector('.environment-summary').textContent).toContain('NODE_ENV');
    expect(fixture.nativeElement.querySelector('.environment-summary').textContent).not.toContain('development');
    const button = (text: string) => [...fixture.nativeElement.querySelectorAll('button')].find(
      (item) => (item as HTMLButtonElement).textContent?.trim() === text) as HTMLButtonElement;
    button('编辑').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const change = async (selector: string, value: string) => {
      const field = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    await change('[name="directory"]', 'D:/project/web with spaces');
    button('添加环境变量').click();
    fixture.detectChanges();
    await fixture.whenStable();
    await change('[aria-label="环境变量名 2"]', 'PORT');
    await change('[aria-label="环境变量值 2"]', ' 4300 ');
    fixture.nativeElement.querySelector('form.editor').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(actions.save).toHaveBeenCalledWith('w', expect.objectContaining({
      workingDirectory: 'D:/project/web with spaces', environment: { NODE_ENV: 'development', PORT: ' 4300 ' },
    }));
    expect(original.environment).toEqual({ NODE_ENV: 'development' });
  });

  it('uses the directory picker to change the command working directory', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      const picker = vi.spyOn(TestBed.inject(DirectoryPickerService), 'select').mockResolvedValue('D:/selected folder');
      const fixture = create();
      const buttons = () => [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
      buttons().find((button) => button.textContent?.trim() === '编辑')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      buttons().find((button) => button.textContent?.trim() === '选择文件夹')!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(picker).toHaveBeenCalledWith('D:/project', '选择命令工作目录');
      expect(fixture.nativeElement.querySelector('[name="directory"]').value).toBe('D:/selected folder');
    } finally {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
      vi.restoreAllMocks();
    }
  });
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
    const labels = [...card.querySelectorAll('.card-buttons button')].map((button) =>
      button.textContent?.trim(),
    );
    expect(labels).toEqual(['启动', '停止', '重启', '控制台', '编辑', '复用', '移除']);
    actions.run.mockResolvedValue('terminal-1');
    await (fixture.componentInstance as unknown as { run(id: string): Promise<void> }).run('a');
    fixture.detectChanges();
    expect(actions.run).toHaveBeenCalledWith('w', 'a', false);
    expect(closed).not.toHaveBeenCalled();
    expect(terminal).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('已启动');
  });

  it('automatically displays results after waiting and opens editing only for the selected suggestion', async () => {
    actions.reviews.set({
      w: { requestId: 'r', terminalId: 'agent', waiting: true, suggestions: [] },
    });
    const fixture = create();
    const tabs = () =>
      [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    tabs()[0].click();
    fixture.detectChanges();
    actions.reviews.set({
      w: {
        requestId: 'r',
        waiting: false,
        suggestions: [
          {
            id: 's',
            name: '测试',
            command: 'npm test',
            workingDirectory: 'D:/project',
            description: '',
            selected: true,
          },
        ],
      },
    });
    fixture.detectChanges();
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(
      fixture.nativeElement.querySelectorAll('.suggestion input:not([type="checkbox"])'),
    ).toHaveLength(0);
    fixture.nativeElement.querySelector('.suggestion button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const command = fixture.nativeElement.querySelector(
      '.editor input[name="command"]',
    ) as HTMLInputElement;
    command.value = 'pnpm test';
    command.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('.editor').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(actions.editSuggestion).toHaveBeenCalledWith(
      'w',
      's',
      expect.objectContaining({ command: 'pnpm test' }),
    );
    expect(actions.save).not.toHaveBeenCalled();
  });

  it('combines text, category and runtime filters and can clear an empty result', async () => {
    const fixture = create({
      commonActions: [
        {
          id: 'dev',
          name: '前端服务',
          command: 'pnpm dev',
          workingDirectory: 'D:/project/web',
          description: '浏览器热更新',
          category: 'develop',
          terminalId: 't',
        },
        {
          id: 'test',
          name: '单元测试',
          command: 'pnpm test',
          workingDirectory: 'D:/project',
          description: '验证业务逻辑',
          category: 'test',
        },
      ],
      terminals: [
        { id: 't', commonActionId: 'dev', status: 'RUNNING' } as Workspace['terminals'][number],
      ],
    });
    const change = async (selector: string, value: string) => {
      const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await change('[aria-label="搜索常用操作"]', '热更新');
    expect(fixture.nativeElement.querySelectorAll('.saved-action')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.saved-action').textContent).toContain('前端服务');
    await change('[aria-label="按分类筛选"]', 'test');
    expect(fixture.nativeElement.querySelectorAll('.saved-action')).toHaveLength(0);
    const reset = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button) => (button as HTMLButtonElement).textContent?.trim() === '清除筛选',
    ) as HTMLButtonElement;
    reset.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.saved-action')).toHaveLength(2);
    await change('[aria-label="按状态筛选"]', 'running');
    expect(fixture.nativeElement.querySelectorAll('.saved-action')).toHaveLength(1);
  });

  it('shows completed and failed results and keeps their consoles accessible', () => {
    const fixture = create({
      commonActions: [
        {
          id: 'a',
          name: '构建',
          command: 'build',
          workingDirectory: 'D:/project',
          description: '',
          terminalId: 'done',
        },
        {
          id: 'b',
          name: '测试',
          command: 'test',
          workingDirectory: 'D:/project',
          description: '',
          terminalId: 'failed',
        },
      ],
      terminals: [
        { id: 'done', commonActionId: 'a', status: 'COMPLETED' },
        { id: 'failed', commonActionId: 'b', status: 'FAILED' },
      ] as Workspace['terminals'],
    });
    const cards = [...fixture.nativeElement.querySelectorAll('.saved-action')] as HTMLElement[];
    expect(cards[0].querySelector('.action-status')?.textContent).toContain('已完成');
    expect(cards[1].querySelector('.action-status')?.textContent).toContain('执行失败');
    expect(cards[1].querySelector('.failure-hint')).not.toBeNull();
    const consoleButton = [...cards[1].querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '控制台',
    )!;
    expect(consoleButton.disabled).toBe(false);
  });

  it('copies commands and reuses an action only as an unsaved draft', async () => {
    const fixture = create();
    fixture.nativeElement.querySelector('.copy-command').click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('npm run dev');
    const reuse = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button) => (button as HTMLButtonElement).textContent?.trim() === '复用',
    ) as HTMLButtonElement;
    reuse.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const draft = (fixture.componentInstance as unknown as { editor(): CommonAction }).editor();
    expect(draft.name).toBe('前端 副本');
    expect(draft.id).not.toBe('a');
    expect(draft.terminalId).toBeUndefined();
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.run).not.toHaveBeenCalled();
  });
});
