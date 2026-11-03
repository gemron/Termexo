import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TerminalMobileInputComponent } from './terminal-mobile-input';

describe('mobile terminal input', () => {
  function create(send = vi.fn().mockResolvedValue(undefined)) {
    const fixture = TestBed.createComponent(TerminalMobileInputComponent);
    fixture.componentRef.setInput('sendText', send);
    fixture.detectChanges();
    const view = fixture.componentInstance as unknown as {
      text: { (): string; set(value: string): void }; send(): Promise<void>; onKeydown(event: KeyboardEvent): void;
    };
    return { fixture, view, send };
  }

  it('keeps focus and a newly typed draft while a send is awaiting acknowledgement', async () => {
    let finish!: () => void;
    const { fixture, view, send } = create(vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    await fixture.whenStable();
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    document.body.append(fixture.nativeElement);
    textarea.focus();
    view.text.set('first');
    const pending = view.send();
    await view.send();
    fixture.detectChanges();
    expect(textarea.disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);
    view.text.set('next draft');
    finish();
    await pending;
    expect(send).toHaveBeenCalledExactlyOnceWith('first');
    expect(view.text()).toBe('next draft');
    fixture.nativeElement.remove();
  });

  it('retains failed messages and blocks sending when disconnected or read-only', async () => {
    const { fixture, view, send } = create(vi.fn().mockRejectedValue(new Error('disconnected')));
    view.text.set('retry me');
    await view.send();
    expect(view.text()).toBe('retry me');
    fixture.detectChanges();
    fixture.componentRef.setInput('disabled', true);
    await view.send();
    expect(send).toHaveBeenCalledOnce();
  });

  it('uses Enter to send while preserving IME confirmation and Shift+Enter', async () => {
    const { view, send } = create();
    view.text.set('message');
    view.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    view.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(send).not.toHaveBeenCalled();
    view.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    expect(send).toHaveBeenCalledExactlyOnceWith('message');
    expect(view.text()).toBe('');
  });
});
