import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectoryPickerService } from '../core/services/directory-picker.service';
import { CreateWorkspaceDialogComponent } from './create-workspace-dialog';

describe('CreateWorkspaceDialogComponent', () => {
  let fixture: ComponentFixture<CreateWorkspaceDialogComponent>;
  let root: HTMLElement;
  const picker = { select: vi.fn() };

  beforeEach(async () => {
    picker.select.mockReset();
    TestBed.configureTestingModule({
      imports: [CreateWorkspaceDialogComponent],
      providers: [{ provide: DirectoryPickerService, useValue: picker }],
    });
    fixture = TestBed.createComponent(CreateWorkspaceDialogComponent);
    fixture.componentInstance.name.set('First project');
    fixture.componentInstance.projectPath.set('D:\\dev\\first');
    fixture.detectChanges();
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  it('blocks resubmission and dismissal while the workspace is being saved', async () => {
    const created = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.created.subscribe(created);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    await fixture.whenStable();

    for (const button of root.querySelectorAll('button')) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    for (const input of root.querySelectorAll('input')) expect(input.disabled).toBe(true);
    root.querySelector('.backdrop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    root
      .querySelector('section')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-busy')).toBe('true');
    expect(created).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('keeps entered values after failure and allows the same creation to be retried', () => {
    const created = vi.fn();
    fixture.componentInstance.created.subscribe(created);
    fixture.componentRef.setInput('error', 'Disk is full');
    fixture.detectChanges();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Disk is full');
    expect(fixture.componentInstance.name()).toBe('First project');
    expect(fixture.componentInstance.projectPath()).toBe('D:\\dev\\first');
    root.querySelector<HTMLButtonElement>('.primary')!.click();
    expect(created).toHaveBeenCalledWith({ name: 'First project', projectPath: 'D:\\dev\\first' });
  });

  it('does not submit the old path while a directory picker is still open', async () => {
    let resolveDirectory!: (path: string) => void;
    picker.select.mockReturnValue(new Promise<string>((resolve) => (resolveDirectory = resolve)));
    const created = vi.fn();
    fixture.componentInstance.created.subscribe(created);
    root.querySelector<HTMLButtonElement>('.directory-button')!.click();
    fixture.detectChanges();

    const submit = root.querySelector<HTMLButtonElement>('.primary')!;
    expect(submit.disabled).toBe(true);
    submit.click();
    expect(created).not.toHaveBeenCalled();

    resolveDirectory('D:\\dev\\chosen');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);
    submit.click();
    expect(created).toHaveBeenCalledWith({ name: 'First project', projectPath: 'D:\\dev\\chosen' });
  });
});
