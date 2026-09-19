import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnchoredMenuDirective } from './anchored-menu.directive';

@Component({
  imports: [AnchoredMenuDirective],
  template: `
    <button #anchor>More</button>
    @if (open) {
      <ul [appAnchoredMenu]="anchor" (dismissed)="open = false" role="menu">
        <li><button>First</button></li>
        <li><button>Second</button></li>
      </ul>
    }
  `,
})
class MenuHost {
  open = true;
}

describe('AnchoredMenuDirective', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(left: number, top: number) {
    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('innerHeight', 300);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('role') === 'menu'
        ? new DOMRect(0, 0, 180, 100)
        : new DOMRect(left, top, 30, 30);
    });
    const fixture = TestBed.createComponent(MenuHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      root,
      menu: root.querySelector<HTMLElement>('ul')!,
      anchor: root.querySelector('button')!,
    };
  }

  it('opens below a top-edge trigger and clamps to the left viewport margin', async () => {
    const { menu } = await render(2, 10);
    expect(menu.style.left).toBe('8px');
    expect(menu.style.top).toBe('44px');
    expect(menu.getAttribute('popover')).toBe('manual');
  });

  it('opens above a bottom-edge trigger and clamps to the right viewport margin', async () => {
    const { menu } = await render(390, 260);
    expect(menu.style.left).toBe('212px');
    expect(menu.style.top).toBe('156px');
  });

  it('supports arrow navigation and restores focus when Escape closes the menu', async () => {
    const { menu, anchor, fixture, root } = await render(100, 100);
    const buttons = menu.querySelectorAll('button');
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('ul')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('allows menu scrolling but dismisses when the surrounding document scrolls', async () => {
    const { menu, root, fixture } = await render(100, 100);
    menu.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(root.querySelector('ul')).toBeTruthy();
    document.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(root.querySelector('ul')).toBeNull();
  });

  it('dismisses on outside pointer input', async () => {
    const { root, fixture } = await render(100, 100);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('ul')).toBeNull();
  });
});
