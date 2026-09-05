import { createId } from '../models/identifiers';

/**
 * Where the Angular app is running.
 *
 * `desktop` is the Tauri WebView, `remote` a browser served by the embedded remote-access server,
 * and `preview` a plain `npm run dev` browser with no backend at all.
 */
export type RuntimeMode = 'desktop' | 'remote' | 'preview';

export interface RemoteRuntimeInfo {
  version: string;
  secure: boolean;
}

const REMOTE_MARKER_SELECTOR = 'meta[name="termexo-remote"]';

/** True only where native windows, dialogs and notification plugins exist. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** The marker the remote server injects into `index.html`; null anywhere else. */
export function remoteRuntimeInfo(): RemoteRuntimeInfo | null {
  const content =
    typeof document === 'undefined'
      ? null
      : document.querySelector(REMOTE_MARKER_SELECTOR)?.getAttribute('content');
  if (!content) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(content);
    if (
      value &&
      typeof value === 'object' &&
      'version' in value &&
      typeof value.version === 'string' &&
      'secure' in value &&
      typeof value.secure === 'boolean'
    ) {
      return { version: value.version, secure: value.secure };
    }
  } catch {
    // A malformed marker must never be trusted: it would make the app open a WebSocket bridge
    // against a page that is not the remote server.
  }
  return null;
}

export function runtimeMode(): RuntimeMode {
  if (isTauriRuntime()) {
    return 'desktop';
  }
  return remoteRuntimeInfo() ? 'remote' : 'preview';
}

/** True when backend commands can be invoked, whichever transport carries them. */
export function hasBackend(): boolean {
  return runtimeMode() !== 'preview';
}

let clientId: string | undefined;

/**
 * Identifies this page load to the backend.
 *
 * Workspace writes carry it so the change events they trigger can be recognised as this client's
 * own echo instead of an external edit that has to be applied again.
 */
export function runtimeClientId(): string {
  return (clientId ??= createId());
}
