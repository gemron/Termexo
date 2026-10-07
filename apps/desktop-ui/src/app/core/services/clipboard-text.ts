import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { isTauriRuntime } from './tauri-runtime';

/** Desktop clipboard access must not depend on WebView2 browser permissions. */
export async function readClipboardText(): Promise<string> {
  if (isTauriRuntime()) {
    return readText();
  }
  // A remote viewer uses its own clipboard, never the desktop host's clipboard.
  if (!navigator.clipboard?.readText) {
    throw new Error('This browser cannot read the clipboard. Use HTTPS or localhost.');
  }
  return navigator.clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauriRuntime()) {
    return writeText(text);
  }
  if (!navigator.clipboard?.writeText) {
    throw new Error('This browser cannot write to the clipboard. Use HTTPS or localhost.');
  }
  return navigator.clipboard.writeText(text);
}
