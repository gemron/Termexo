import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it, vi } from 'vitest';

import { I18nService } from '../core/i18n/i18n.service';
import type { CommonActionOperation } from '../core/models/common-action';
import type { CommonAction, TerminalStatus } from '../core/models/workspace.models';
import { CommonActionTerminalControlsComponent } from './common-action-terminal-controls';

describe('common action terminal controls', () => {
  let fixture: ComponentFixture<CommonActionTerminalControlsComponent>;
  let root: HTMLElement;
  const action: CommonAction = {
    id: 'dev', name: 'Web server', command: 'npm run dev', workingDirectory: 'D:/project', description: '',
  };

  beforeEach(() => {
    TestBed.inject(I18nService).setPreference('en');
    fixture = TestBed.createComponent(CommonActionTerminalControlsComponent);
    fixture.componentRef.setInput('action', action);
    fixture.componentRef.setInput('status', 'RUNNING');
    fixture.detectChanges();
    root = fixture.nativeElement;
  });

  const button = (operation: CommonActionOperation) =>
    root.querySelector<HTMLButtonElement>(`[data-action="${operation}"]`);

  it('offers restart and stop for a live command without typing into the terminal', () => {
    const requested = vi.fn();
    fixture.componentInstance.operationRequested.subscribe(requested);
    expect(root.querySelector('code')?.textContent).toBe(action.command);
    expect(button('run')).toBeNull();
    button('restart')!.click();
    button('stop')!.click();
    expect(requested.mock.calls).toEqual([['restart'], ['stop']]);
  });

  it.each<TerminalStatus>(['COMPLETED', 'FAILED', 'STOPPED', 'DISCONNECTED'])(
    'offers a new run for %s without presenting a stop for an exited process', (status) => {
      fixture.componentRef.setInput('status', status);
      fixture.detectChanges();
      const requested = vi.fn();
      fixture.componentInstance.operationRequested.subscribe(requested);
      expect(button('restart')).toBeNull();
      expect(button('stop')).toBeNull();
      expect(button('run')?.textContent).toContain('Run again');
      button('run')!.click();
      expect(requested).toHaveBeenCalledExactlyOnceWith('run');
    },
  );

  it('disables all controls while a workspace operation is pending', () => {
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    const requested = vi.fn();
    fixture.componentInstance.operationRequested.subscribe(requested);
    expect(root.querySelector('[role="group"]')?.getAttribute('aria-busy')).toBe('true');
    for (const element of root.querySelectorAll<HTMLButtonElement>('button')) {
      expect(element.disabled).toBe(true);
      element.click();
    }
    expect(requested).not.toHaveBeenCalled();
  });

  it('has no interactive controls in read-only mode', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    expect(root.querySelector('button')).toBeNull();
    expect(root.querySelector('[role="group"]')).toBeNull();
  });

  it('keeps button presses from triggering the terminal input focus handler', () => {
    const focus = vi.fn();
    root.addEventListener('mousedown', focus);
    button('stop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(focus).not.toHaveBeenCalled();
  });

  it('localizes the controls in the German UI', () => {
    TestBed.inject(I18nService).setPreference('de');
    fixture.detectChanges();
    expect(button('restart')?.textContent).toContain('Neustarten');
    expect(button('stop')?.textContent).toContain('Stoppen');
    fixture.componentRef.setInput('status', 'COMPLETED');
    fixture.detectChanges();
    expect(button('run')?.textContent).toContain('Erneut ausführen');
  });
});
