/**
 * Generates a v4 UUID that also works outside a secure context.
 *
 * `crypto.randomUUID` is only exposed on secure origins, so a remote workbench opened over plain
 * HTTP on a LAN address would otherwise fail to create workspaces or terminals. `getRandomValues`
 * has no such restriction and supplies the same 122 random bits.
 */
export function createId(): string {
  const random = globalThis.crypto;
  if (random?.randomUUID) {
    return random.randomUUID();
  }

  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
