import {
  clearRemoteToken,
  REMOTE_TOKEN_STORAGE_KEY,
  remoteTokenStorageKey,
  resolveRemoteToken,
  storeRemoteToken,
} from './remote-token';

/** Serves the rest of the test from a sub-path, the way a relay serves `/d/<deviceId>/`. */
function withBaseHref(path: string, body: () => void): void {
  const element = document.createElement('base');
  element.setAttribute('href', path);
  document.head.appendChild(element);
  try {
    body();
  } finally {
    element.remove();
  }
}

describe('resolveRemoteToken', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('prefers the fragment and strips the token from the address bar', () => {
    window.history.replaceState(null, '', '/?token=from-query#token=from-fragment&view=git');

    expect(resolveRemoteToken()).toBe('from-fragment');
    // A token left in the URL would survive in history, a bookmark or a screenshot.
    expect(window.location.hash).toBe('#view=git');
    expect(window.location.search).toBe('');
    expect(localStorage.getItem(REMOTE_TOKEN_STORAGE_KEY)).toBe('from-fragment');
  });

  it('accepts a token from the query string when the fragment carries none', () => {
    window.history.replaceState(null, '', '/?token=from-query&view=git');

    expect(resolveRemoteToken()).toBe('from-query');
    expect(window.location.search).toBe('?view=git');
  });

  it('reads the stored token on a later visit', () => {
    storeRemoteToken('stored');

    expect(resolveRemoteToken()).toBe('stored');
  });

  it('reports no token once it is forgotten', () => {
    storeRemoteToken('stored');
    clearRemoteToken();

    expect(resolveRemoteToken()).toBeNull();
  });

  it('keeps the unsuffixed key for a page served at the site root', () => {
    expect(remoteTokenStorageKey()).toBe(REMOTE_TOKEN_STORAGE_KEY);
  });

  it('gives each relayed device its own key so they cannot overwrite each other', () => {
    withBaseHref('/d/abc/', () => {
      storeRemoteToken('device-abc');

      expect(remoteTokenStorageKey()).toBe(`${REMOTE_TOKEN_STORAGE_KEY}:/d/abc/`);
      expect(localStorage.getItem(`${REMOTE_TOKEN_STORAGE_KEY}:/d/abc/`)).toBe('device-abc');
    });

    withBaseHref('/d/xyz/', () => {
      expect(resolveRemoteToken()).toBeNull();
      storeRemoteToken('device-xyz');
    });

    withBaseHref('/d/abc/', () => {
      expect(resolveRemoteToken()).toBe('device-abc');
    });
    // The LAN key is untouched by either of them.
    expect(localStorage.getItem(REMOTE_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
