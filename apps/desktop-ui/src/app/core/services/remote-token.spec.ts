import {
  clearRemoteToken,
  REMOTE_TOKEN_STORAGE_KEY,
  resolveRemoteToken,
  storeRemoteToken,
} from './remote-token';

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
});
