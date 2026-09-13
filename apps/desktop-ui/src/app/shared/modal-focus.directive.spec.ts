import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ModalFocusDirective } from './modal-focus.directive';

@Component({
  imports: [ModalFocusDirective],
  template: `
    <button id="trigger">Open</button>
    @if (open()) {
      <section appModal (dismissModal)="open.set(false)">
        <input id="first" />
        <button disabled>Unavailable</button>
        <button id="last">Open nested</button>
      </section>
    }
    @if (nested()) {
      <section appModal (dismissModal)="nested.set(false)"><input id="nested" /></section>
    }
  `,
})
class ModalHost {
  readonly open = signal(false);
  readonly nested = signal(false);
}

describe('ModalFocusDirective', () => {
  afterEach(() => vi.restoreAllMocks());

  it('contains keyboard focus, dismisses only the top dialog and restores its trigger', async () => {
    // jsdom has no layout; every control in this fixture except :disabled is visible.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(0, 0, 10, 10),
    ] as unknown as DOMRectList);
    const fixture = TestBed.createComponent(ModalHost);
    const root: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();
    const trigger = root.querySelector<HTMLButtonElement>('#trigger')!;
    trigger.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const first = root.querySelector<HTMLInputElement>('#first')!;
    const last = root.querySelector<HTMLButtonElement>('#last')!;
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(first);
    trigger.focus();
    expect(document.activeElement).toBe(first);
    last.focus();
    fixture.componentInstance.nested.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(true);
    expect(fixture.componentInstance.nested()).toBe(false);
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(trigger);
  });
});
