import { parseRemoteAccessLink } from './remote-host.models';

describe('parseRemoteAccessLink', () => {
  it('extracts the base URL and token from a LAN access link with a fragment', () => {
    const parsed = parseRemoteAccessLink('https://192.168.1.20:7420/#token=abc_123');

    expect(parsed).toEqual({
      url: 'https://192.168.1.20:7420/',
      token: 'abc_123',
      suggestedName: '192.168.1.20:7420',
      kind: 'lan',
    });
  });

  it('recognizes a relay device URL and strips the token from the stored address', () => {
    const parsed = parseRemoteAccessLink(
      'https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/#token=secret%2B1',
    );

    expect(parsed).toEqual({
      url: 'https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/',
      token: 'secret+1',
      suggestedName: 'relay.example.com (abcdef)',
      kind: 'relay',
    });
  });

  it('accepts a bare address without a token and rejects non-HTTP schemes', () => {
    expect(parseRemoteAccessLink('http://10.0.0.8:7420')).toEqual({
      url: 'http://10.0.0.8:7420/',
      token: null,
      suggestedName: '10.0.0.8:7420',
      kind: 'lan',
    });
    expect(parseRemoteAccessLink('ws://10.0.0.8:7420')).toBeNull();
    expect(parseRemoteAccessLink('not a url')).toBeNull();
  });
});
