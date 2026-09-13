import { readClipboardWrite } from './terminal-clipboard';

describe('readClipboardWrite', () => {
  it('decodes the text OpenCode copies', () => {
    // What OpenCode 1.18 sent for a selection of "anythin".
    expect(readClipboardWrite('c;YW55dGhpbg==')).toBe('anythin');
  });

  it('decodes text beyond ASCII as UTF-8', () => {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode('复制 ✓')));

    expect(readClipboardWrite(`c;${encoded}`)).toBe('复制 ✓');
  });

  it('accepts a payload that names no clipboard target', () => {
    expect(readClipboardWrite(';aGVsbG8=')).toBe('hello');
  });

  it('refuses to read the clipboard back to the program', () => {
    expect(readClipboardWrite('c;?')).toBeNull();
  });

  it('refuses to wipe the clipboard with an empty payload', () => {
    expect(readClipboardWrite('c;')).toBeNull();
  });

  it('ignores payloads that are not base64 or have no data at all', () => {
    expect(readClipboardWrite('c;not base64!')).toBeNull();
    expect(readClipboardWrite('c')).toBeNull();
  });
});
