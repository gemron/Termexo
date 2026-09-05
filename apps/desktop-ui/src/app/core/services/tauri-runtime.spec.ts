import { hasBackend, isTauriRuntime, remoteRuntimeInfo, runtimeMode } from './tauri-runtime';

describe('runtimeMode', () => {
  const runtime = globalThis as unknown as Record<string, unknown>;

  function markRemote(content: string): void {
    const marker = document.createElement('meta');
    marker.setAttribute('name', 'termexo-remote');
    marker.setAttribute('content', content);
    document.head.append(marker);
  }

  afterEach(() => {
    delete runtime['__TAURI_INTERNALS__'];
    document.querySelectorAll('meta[name="termexo-remote"]').forEach((node) => node.remove());
  });

  it('reports the desktop runtime inside the Tauri WebView', () => {
    runtime['__TAURI_INTERNALS__'] = {};

    expect(runtimeMode()).toBe('desktop');
    expect(isTauriRuntime()).toBe(true);
    expect(hasBackend()).toBe(true);
  });

  it('reports the remote runtime when the server injected its marker', () => {
    markRemote('{"version":"0.7.0","secure":true}');

    expect(runtimeMode()).toBe('remote');
    expect(isTauriRuntime()).toBe(false);
    expect(hasBackend()).toBe(true);
    expect(remoteRuntimeInfo()).toEqual({ version: '0.7.0', secure: true });
  });

  it('reports browser preview without any marker', () => {
    expect(runtimeMode()).toBe('preview');
    expect(hasBackend()).toBe(false);
  });

  it('refuses to trust a malformed marker', () => {
    // A marker this app cannot parse would otherwise make it open a bridge against a page that
    // is not the remote-access server.
    markRemote('not-json');

    expect(remoteRuntimeInfo()).toBeNull();
    expect(runtimeMode()).toBe('preview');
  });

  it('refuses a marker missing the fields it promises', () => {
    markRemote('{"version":"0.7.0"}');

    expect(remoteRuntimeInfo()).toBeNull();
    expect(runtimeMode()).toBe('preview');
  });
});
