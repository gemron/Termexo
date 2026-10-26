import { vi } from 'vitest';
import { readClipboardText, writeClipboardText } from './clipboard-text';

describe('clipboard text access', () => {
  const readText = vi.fn();
  const writeText = vi.fn();
  const runtime = window as unknown as Record<string, unknown>;
  const nativeRuntime = () => ({
    invoke: (command: string, args?: { text: string }) =>
      command === 'plugin:clipboard-manager|read_text' ? readText() : writeText(args!.text),
  });

  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    delete runtime['__TAURI_INTERNALS__'];
    document.querySelectorAll('meta[name="termexo-remote"]').forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it('reads and writes natively on desktop when WebView2 has no browser clipboard API', async () => {
    runtime['__TAURI_INTERNALS__'] = nativeRuntime();
    vi.stubGlobal('navigator', {});
    const text = '  中文\r\nsecond line\t ';
    vi.mocked(readText).mockResolvedValue(text);

    expect(await readClipboardText()).toBe(text);
    await writeClipboardText(text);
    expect(readText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it('does not use WebView2 clipboard methods even when they reject permission', async () => {
    runtime['__TAURI_INTERNALS__'] = nativeRuntime();
    const browserRead = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const browserWrite = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { readText: browserRead, writeText: browserWrite } });
    vi.mocked(readText).mockResolvedValue('native');
    await readClipboardText();
    await writeClipboardText('native');
    expect(browserRead).not.toHaveBeenCalled();
    expect(browserWrite).not.toHaveBeenCalled();
  });

  it('uses only the viewer clipboard in a remote browser with a desktop backend', async () => {
    const marker = document.createElement('meta');
    marker.name = 'termexo-remote';
    marker.content = '{"version":"0.10.11","secure":true}';
    document.head.append(marker);
    const browserRead = vi.fn().mockResolvedValue('viewer text');
    const browserWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { readText: browserRead, writeText: browserWrite } });
    expect(await readClipboardText()).toBe('viewer text');
    await writeClipboardText('copied text');
    expect(browserWrite).toHaveBeenCalledExactlyOnceWith('copied text');
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports a missing browser API instead of silently returning no text', async () => {
    vi.stubGlobal('navigator', {});
    await expect(readClipboardText()).rejects.toThrow('cannot read the clipboard');
    await expect(writeClipboardText('text')).rejects.toThrow('cannot write to the clipboard');
  });

  it('preserves native errors so the terminal can tell the user why paste failed', async () => {
    runtime['__TAURI_INTERNALS__'] = nativeRuntime();
    vi.mocked(readText).mockRejectedValue('Clipboard is busy');
    await expect(readClipboardText()).rejects.toBe('Clipboard is busy');
  });
});
