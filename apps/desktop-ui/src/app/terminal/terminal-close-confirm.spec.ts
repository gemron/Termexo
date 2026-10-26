import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalCloseConfirmComponent } from './terminal-close-confirm';

describe('TerminalCloseConfirmComponent', () => {
  let fixture: ComponentFixture<TerminalCloseConfirmComponent>;
  let panel: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 700);
    // jsdom does not lay out the panel; use its rendered size to exercise viewport placement.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 360, 140),
    );
    fixture = TestBed.createComponent(TerminalCloseConfirmComponent);
    fixture.componentRef.setInput('anchor', { x: 200, y: 100 });
    fixture.detectChanges();
    panel = fixture.nativeElement.querySelector('[role="alertdialog"]');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens beside the click and follows a new close request', () => {
    expect(panel.style.left).toBe('210px');
    expect(panel.style.top).toBe('110px');
    fixture.componentRef.setInput('anchor', { x: 400, y: 300 });
    fixture.detectChanges();
    expect(panel.style.left).toBe('410px');
    expect(panel.style.top).toBe('310px');
  });

  it('flips above and left near the bottom-right corner', () => {
    fixture.componentRef.setInput('anchor', { x: 990, y: 690 });
    fixture.detectChanges();
    expect(panel.style.left).toBe('620px');
    expect(panel.style.top).toBe('540px');
  });

  it('clamps an old click position when the window shrinks', () => {
    fixture.componentRef.setInput('anchor', { x: 990, y: 690 });
    fixture.detectChanges();
    vi.stubGlobal('innerWidth', 500);
    vi.stubGlobal('innerHeight', 300);
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    expect(panel.style.left).toBe('132px');
    expect(panel.style.top).toBe('152px');
  });

  it('cancels on Escape and outside clicks while leaving inside clicks alone', () => {
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cancelled).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toHaveBeenCalledOnce();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it('requires an explicit confirmation and disables both actions while busy', () => {
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    const confirm = panel.querySelector<HTMLButtonElement>('.btn-error')!;
    confirm.click();
    expect(confirmed).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    for (const button of panel.querySelectorAll('button')) expect(button.disabled).toBe(true);
    confirm.click();
    expect(confirmed).toHaveBeenCalledOnce();
  });
});
