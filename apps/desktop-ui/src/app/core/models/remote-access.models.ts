/** Settings the user controls from the remote-access panel. */
export interface RemoteAccessSettings {
  enabled: boolean;
  bindAddress: string;
  port: number;
  tls: boolean;
}

/** One IPv4 address the machine can be reached on. */
export interface RemoteAccessAddress {
  address: string;
  interfaceName: string;
  loopback: boolean;
}

export interface RemoteAccessStatus {
  settings: RemoteAccessSettings;
  running: boolean;
  /** Reason the last start attempt failed, in Chinese, or null after a clean start. */
  error: string | null;
  addresses: RemoteAccessAddress[];
  /** Empty until a token has been generated. */
  token: string;
  connectedClients: number;
}

/** A QR code as an SVG path, rendered through an attribute binding rather than innerHTML. */
export interface QrCodeImage {
  path: string;
  size: number;
}

export type RemoteConnectionState =
  'idle' | 'connecting' | 'authenticating' | 'ready' | 'reconnecting' | 'unauthorized';

/** Frames the browser sends over `/ws`. */
export type RemoteClientFrame =
  | { type: 'auth'; token: string; clientId: string }
  | { type: 'invoke'; id: number; command: string; args?: Record<string, unknown> }
  | { type: 'ping' };

/** Frames the remote-access server sends back. */
export type RemoteServerFrame =
  | { type: 'ready'; serverVersion: string }
  | { type: 'auth-failed'; reason: string }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: unknown }
  | { type: 'event'; name: string; payload: unknown }
  | { type: 'resync' }
  | { type: 'pong' };
