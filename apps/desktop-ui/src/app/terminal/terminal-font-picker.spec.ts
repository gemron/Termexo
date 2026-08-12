import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TerminalFontPickerComponent } from './terminal-font-picker';
import { TerminalFontService } from './terminal-font.service';
import { SystemFont } from './terminal-font';

const INSTALLED: readonly SystemFont[] = [
  { name: 'Arial', monospaced: false },
  { name: 'Cascadia Mono', monospaced: true },
  { name: 'Consolas', monospaced: true },
  { name: 'Microsoft YaHei UI', monospaced: false },
];

/** Stands in for the IPC-backed service so the picker can be driven without a desktop shell. */
class StubTerminalFontService {
  readonly fonts = signal<readonly SystemFont[]>(INSTALLED);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  loadCount = 0;
  /** Set to make `load()` block until `deliver()`, the way the desktop's IPC call does. */
  deliverOnLoad: readonly SystemFont[] | null = null;
  private release: (() => void) | null = null;

  async load(): Promise<void> {
    this.loadCount += 1;
    if (this.deliverOnLoad) {
      const arriving = this.deliverOnLoad;
      this.deliverOnLoad = null;
      // Held open until the test releases it, so the wait is a fact rather than a race.
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
      this.fonts.set(arriving);
    }
  }

  /** Releases a pending `load()`, standing in for the IPC reply coming back. */
  deliver(): void {
    this.release?.();
    this.release = null;
  }
}

/** The picker defers focus and the starting highlight to the frame after the list renders. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('TerminalFontPickerComponent', () => {
  let fixture: ComponentFixture<TerminalFontPickerComponent>;
  let root: HTMLElement;
  let fonts: StubTerminalFontService;

  const optionNames = (): string[] =>
    Array.from(root.querySelectorAll<HTMLElement>('li[role="option"] .name')).map(
      (element) => element.textContent?.trim() ?? '',
    );

  const open = async (): Promise<void> => {
    root.querySelector<HTMLButtonElement>('.trigger')?.click();
    fixture.detectChanges();
    await nextFrame();
    fixture.detectChanges();
  };

  const search = (value: string): void => {
    const input = root.querySelector<HTMLInputElement>('.search input');
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const pressKey = (key: string): void => {
    root
      .querySelector<HTMLInputElement>('.search input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    // jsdom leaves scrollIntoView unimplemented, and the picker scrolls the highlighted row.
    Element.prototype.scrollIntoView = (): void => undefined;

    await TestBed.configureTestingModule({
      imports: [TerminalFontPickerComponent],
      providers: [{ provide: TerminalFontService, useClass: StubTerminalFontService }],
    }).compileComponents();

    fixture = TestBed.createComponent(TerminalFontPickerComponent);
    root = fixture.nativeElement as HTMLElement;
    fonts = TestBed.inject(TerminalFontService) as unknown as StubTerminalFontService;
    fixture.componentRef.setInput('value', 'Consolas');
    fixture.detectChanges();
  });

  it('shows the current font and keeps the list closed until asked', () => {
    expect(root.querySelector('.current')?.textContent).toContain('Consolas');
    expect(root.querySelector('.popover')).toBeNull();
    expect(fonts.loadCount).toBe(0);
  });

  it('lists every installed font with monospaced families first', async () => {
    await open();

    expect(fonts.loadCount).toBe(1);
    expect(optionNames()).toEqual(['Cascadia Mono', 'Consolas', 'Arial', 'Microsoft YaHei UI']);
    // Both groups are labelled, so the proportional fonts read as a deliberate second choice.
    expect(Array.from(root.querySelectorAll('.group')).length).toBe(2);
  });

  it('renders each option in its own font so the list previews itself', async () => {
    await open();
    const first = root.querySelector<HTMLElement>('li[role="option"] .name');

    expect(first?.style.fontFamily).toContain('Cascadia Mono');
  });

  it('marks the applied font as selected', async () => {
    await open();
    const selected = root.querySelector<HTMLElement>('li[role="option"][aria-selected="true"]');

    expect(selected?.textContent).toContain('Consolas');
  });

  it('filters as the user types and reports an empty result', async () => {
    await open();

    search('yahei');
    expect(optionNames()).toEqual(['Microsoft YaHei UI']);

    search('nothing installed');
    expect(optionNames()).toEqual([]);
    expect(root.querySelector('.empty')?.textContent?.trim()).toBeTruthy();
  });

  it('emits the font clicked in the list and closes', async () => {
    const selected: string[] = [];
    fixture.componentInstance.fontChange.subscribe((name: string) => selected.push(name));

    await open();
    search('cascadia');
    root.querySelector<HTMLButtonElement>('li[role="option"] button')?.click();
    fixture.detectChanges();

    expect(selected).toEqual(['Cascadia Mono']);
    expect(root.querySelector('.popover')).toBeNull();
  });

  it('starts the highlight on the applied font and selects with the keyboard', async () => {
    const selected: string[] = [];
    fixture.componentInstance.fontChange.subscribe((name: string) => selected.push(name));

    await open();
    // Consolas is applied and sits second, so one step down must land on the third entry.
    pressKey('ArrowDown');
    pressKey('ArrowDown');
    pressKey('ArrowUp');
    pressKey('Enter');

    expect(selected).toEqual(['Arial']);
  });

  it('places the highlight on the applied font when the list arrives late', async () => {
    // On the desktop the families come over IPC, so the popover opens against an empty list.
    fonts.fonts.set([]);
    fonts.deliverOnLoad = INSTALLED;
    const selected: string[] = [];
    fixture.componentInstance.fontChange.subscribe((name: string) => selected.push(name));

    await open();
    // The picker's own opening callback has already run against the empty list by this point.
    expect(optionNames()).toEqual([]);

    fonts.deliver();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await nextFrame();
    fixture.detectChanges();

    // Without waiting for the list, the highlight would have settled on the first row.
    pressKey('Enter');
    expect(selected).toEqual(['Consolas']);
  });

  it('wraps the highlight at both ends of the list', async () => {
    const selected: string[] = [];
    fixture.componentInstance.fontChange.subscribe((name: string) => selected.push(name));

    await open();
    pressKey('End');
    pressKey('ArrowDown');
    pressKey('Enter');
    expect(selected).toEqual(['Cascadia Mono']);

    await open();
    pressKey('Home');
    pressKey('ArrowUp');
    pressKey('Enter');
    expect(selected).toEqual(['Cascadia Mono', 'Microsoft YaHei UI']);
  });

  it('closes on Escape without emitting a change', async () => {
    const selected: string[] = [];
    fixture.componentInstance.fontChange.subscribe((name: string) => selected.push(name));

    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(root.querySelector('.popover')).toBeNull();
    expect(selected).toEqual([]);
  });

  it('closes when a pointer lands outside the picker', async () => {
    await open();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(root.querySelector('.popover')).toBeNull();
  });
});
