import { createId } from './identifiers';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the native generator where it is available', () => {
    expect(createId()).toMatch(UUID_V4);
  });

  it('still produces a valid v4 UUID outside a secure context', () => {
    // `crypto.randomUUID` is missing on a plain-HTTP LAN origin, which is where a remote client
    // creating a workspace or a terminal would otherwise fail.
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = (index * 37) % 256;
        }
        return bytes;
      },
    });

    expect(createId()).toMatch(UUID_V4);
  });

  it('does not repeat itself', () => {
    expect(createId()).not.toBe(createId());
  });
});
