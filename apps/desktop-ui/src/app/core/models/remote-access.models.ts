/** How the link to the relay this desktop enrolled with is doing right now. */
export type RelayLinkState = 'disabled' | 'connecting' | 'connected' | 'revoked' | 'error';

/** Relay settings; the credential itself never leaves the backend's keyring. */
export interface RelaySettings {
  enabled: boolean;
  url: string;
  /** TOFU fingerprint pinned for a self-signed relay, null for a publicly trusted certificate. */
  certificateFingerprint: string | null;
}

/** One public address this desktop can be reached on, as announced by a relay in the chain. */
export interface RelayAddress {
  relayId: string;
  relayName: string;
  /** Always ends with a slash, so a token fragment can be appended directly. */
  url: string;
  /** 0 on the relay this desktop dialled, 1 for its upstream, and so on. */
  hops: number;
}

export interface RelayStatus {
  state: RelayLinkState;
  /** Reason the link failed or was revoked, in Chinese, or null while it is healthy. */
  error: string | null;
  deviceId: string | null;
  deviceName: string | null;
  addresses: RelayAddress[];
  connectedSince: number | null;
}

/** The two ways a desktop can trade its way into a relay; the relay tells them apart by `method`. */
export type RelayEnrollMethod =
  | { method: 'code'; code: string; name: string }
  | { method: 'password'; username: string; password: string; name: string };

export interface RelayEnrollRequest {
  url: string;
  method: RelayEnrollMethod;
  name: string;
}

/** Settings the user controls from the remote-access panel. */
export interface RemoteAccessSettings {
  enabled: boolean;
  bindAddress: string;
  port: number;
  tls: boolean;
  relay: RelaySettings;
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
  relay: RelayStatus;
}

/** A QR code as an SVG path, rendered through an attribute binding rather than innerHTML. */
export interface QrCodeImage {
  path: string;
  size: number;
}

export type RemoteConnectionState =
  'idle' | 'connecting' | 'authenticating' | 'ready' | 'reconnecting' | 'unauthorized';

/** The envelope every frame of a sealed session travels in, in both directions. */
export interface RemoteSealedEnvelope {
  /** The sender's frame counter, which also supplies the cipher nonce. */
  n: number;
  /** base64url of the AES-256-GCM ciphertext with its tag appended. */
  c: string;
}

/** Frames the browser sends over `/ws`. */
export type RemoteClientFrame =
  /** v1, kept for a plain-http page on the local network, where the browser has no WebCrypto. */
  | { type: 'auth'; token: string; clientId: string }
  /** v2: the token stays in the browser and only a proof derived from it is sent. */
  | { type: 'auth'; protocol: number; clientId: string; nonceC: string; proof: string }
  | { type: 'invoke'; id: number; command: string; args?: Record<string, unknown> }
  | { type: 'ping' }
  | ({ type: 'sealed' } & RemoteSealedEnvelope);

/** Frames the remote-access server sends back. */
export type RemoteServerFrame =
  /** The first frame on every connection; its nonce seeds the session keys. */
  | { type: 'challenge'; protocol: number; nonceS: string }
  | { type: 'ready'; serverVersion: string }
  | { type: 'auth-failed'; reason: string }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: unknown }
  | { type: 'event'; name: string; payload: unknown }
  | { type: 'resync' }
  | { type: 'pong' }
  | ({ type: 'sealed' } & RemoteSealedEnvelope);
