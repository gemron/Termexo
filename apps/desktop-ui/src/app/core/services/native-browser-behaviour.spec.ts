import { afterEach, describe, expect, it } from 'vitest';

import { isBrowserShortcut, suppressNativeBrowserBehaviour } from './native-browser-behaviour';

function key(
  value: string,
  modifiers: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {},
) {
  return { key: value, ctrlKey: false, altKey: false, metaKey: false, ...modifiers };
}

describe('isBrowserShortcut', () => {
  it('recognizes every way the page can be reloaded', () => {
    expect(isBrowserShortcut(key('F5'))).toBe(true);
    expect(isBrowserShortcut(key('F5', { ctrlKey: true }))).toBe(true);
    expect(isBrowserShortcut(key('r', { ctrlKey: true }))).toBe(true);
    // Ctrl+Shift+R, where the browser reports the letter in upper case.
    expect(isBrowserShortcut(key('R', { ctrlKey: true }))).toBe(true);
  });

  it('recognizes history navigation, which would leave the workbench entirely', () => {
    expect(isBrowserShortcut(key('ArrowLeft', { altKey: true }))).toBe(true);
    expect(isBrowserShortcut(key('ArrowRight', { altKey: true }))).toBe(true);
  });

  it('recognizes save and print, the other actions the browser menu offered', () => {
    expect(isBrowserShortcut(key('s', { ctrlKey: true }))).toBe(true);
    expect(isBrowserShortcut(key('p', { ctrlKey: true }))).toBe(true);
  });

  it('leaves the plain keys alone, which belong to whatever has focus', () => {
    expect(isBrowserShortcut(key('r'))).toBe(false);
    expect(isBrowserShortcut(key('ArrowLeft'))).toBe(false);
    expect(isBrowserShortcut(key('F5', { metaKey: true }))).toBe(false);
  });

  it('leaves Ctrl+Alt combinations alone, since AltGr types characters with them', () => {
    expect(isBrowserShortcut(key('r', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isBrowserShortcut(key('ArrowLeft', { ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe('suppressNativeBrowserBehaviour', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  function rightClick(target: Element): boolean {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  function press(init: KeyboardEventInit): boolean {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('refuses the browser menu on ordinary content', () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    dispose = suppressNativeBrowserBehaviour();

    expect(rightClick(panel)).toBe(true);
  });

  it('leaves a text field its editing menu, which nothing here replaces', () => {
    const field = document.createElement('input');
    document.body.append(field);
    dispose = suppressNativeBrowserBehaviour();

    expect(rightClick(field)).toBe(false);
  });

  it('leaves an editable region its menu even when the press lands on a child', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editor.append(child);
    document.body.append(editor);
    dispose = suppressNativeBrowserBehaviour();

    expect(rightClick(child)).toBe(false);
  });

  it('refuses reload, so the workbench is not rebuilt under the running terminals', () => {
    dispose = suppressNativeBrowserBehaviour();

    expect(press({ key: 'F5' })).toBe(true);
    expect(press({ key: 'r', ctrlKey: true })).toBe(true);
  });

  it('lets an ordinary key through to whatever has focus', () => {
    dispose = suppressNativeBrowserBehaviour();

    expect(press({ key: 'r' })).toBe(false);
  });

  it('stops refusing once disposed', () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    suppressNativeBrowserBehaviour()();

    expect(rightClick(panel)).toBe(false);
    expect(press({ key: 'F5' })).toBe(false);
  });
});
