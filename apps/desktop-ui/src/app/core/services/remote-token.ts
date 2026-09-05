/** Where this browser keeps the remote-access token between visits. */
export const REMOTE_TOKEN_STORAGE_KEY = 'termexo.remote.token';

const TOKEN_PARAMETER = 'token';

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(REMOTE_TOKEN_STORAGE_KEY);
  } catch {
    // Private-mode browsers can refuse storage entirely; the token then lives for one page load.
    return null;
  }
}

/** Reads the token the shared link or QR code carried, in fragment-before-query order. */
function readLocation(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  return fragment.get(TOKEN_PARAMETER) ?? query.get(TOKEN_PARAMETER);
}

/**
 * Removes the token from the address bar once it has been stored.
 *
 * A token grants full control of the desktop Termexo, so it must not survive in the history
 * entry, a bookmark or a screenshot of the browser window.
 */
function scrubLocation(): void {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  fragment.delete(TOKEN_PARAMETER);
  url.searchParams.delete(TOKEN_PARAMETER);
  const remainingFragment = fragment.toString();
  url.hash = remainingFragment ? `#${remainingFragment}` : '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function storeRemoteToken(token: string): void {
  try {
    window.localStorage.setItem(REMOTE_TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage is optional: the caller still connects with the token it holds.
  }
}

export function clearRemoteToken(): void {
  try {
    window.localStorage.removeItem(REMOTE_TOKEN_STORAGE_KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

/**
 * Resolves the access token: URL fragment, then URL query, then this browser's stored copy.
 *
 * Calling it repeatedly is safe — a token found in the URL is persisted and stripped on the first
 * call, so every later call reads the same value back from storage.
 */
export function resolveRemoteToken(): string | null {
  const fromLocation = readLocation();
  if (fromLocation) {
    storeRemoteToken(fromLocation);
    scrubLocation();
    return fromLocation;
  }
  return readStorage();
}
