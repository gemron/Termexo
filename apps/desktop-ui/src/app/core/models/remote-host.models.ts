export type RemoteHostKind = 'lan' | 'relay';

export type RemoteHostHealth =
  | 'unknown'
  | 'probing'
  | 'online'
  | 'offline'
  | 'unauthorized'
  | 'untrusted-certificate'
  | 'incompatible';

export interface RemoteHost {
  id: string;
  name: string;
  kind: RemoteHostKind;
  /** Always ends with `/`: `http(s)://host[:port]/` or `http(s)://relay[:port]/d/<deviceId>/`. */
  url: string;
  readOnly: boolean;
  group: string | null;
  color: string | null;
  sortOrder: number;
  createdAt: number;
  lastConnectedAt: number | null;
}

export interface RemoteHostStatus {
  hostId: string;
  health: RemoteHostHealth;
  version: string | null;
  latencyMs: number | null;
  checkedAt: number | null;
  error: string | null;
  open: boolean;
}

export interface RemoteHostsSnapshot {
  hosts: RemoteHost[];
  statuses: RemoteHostStatus[];
}

export interface SaveRemoteHostRequest {
  id?: string | null;
  name: string;
  url: string;
  token?: string | null;
  group?: string | null;
  color?: string | null;
}

export interface ProbeRemoteHostRequest {
  hostId?: string | null;
  url?: string | null;
  token?: string | null;
  verifyToken?: boolean;
}

export interface ProbeOutcome {
  health: RemoteHostHealth;
  version: string | null;
  latencyMs: number | null;
  readOnly: boolean | null;
  error: string | null;
}

export interface ParsedRemoteAccessLink {
  url: string;
  token: string | null;
  suggestedName: string;
  kind: RemoteHostKind;
}

const RELAY_PATH_PATTERN = /^\/d\/([a-z0-9]{26})\/?$/;

/**
 * Extracts a remote Termexo base URL, its `#token=` / `?token=` secret, and a sensible default
 * display name from a pasted access link. Returns `null` when the text is not an `http(s)` URL.
 */
export function parseRemoteAccessLink(raw: string): ParsedRemoteAccessLink | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  const fragmentParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(parsed.search);
  const rawToken = fragmentParams.get('token')?.trim() || queryParams.get('token')?.trim() || null;

  const relayMatch = RELAY_PATH_PATTERN.exec(parsed.pathname);
  const kind: RemoteHostKind = relayMatch ? 'relay' : 'lan';
  const normalizedPath = relayMatch ? `/d/${relayMatch[1]}/` : '/';
  const baseUrl = `${parsed.origin}${normalizedPath}`;
  const suggestedName = relayMatch
    ? `${parsed.hostname} (${relayMatch[1].slice(0, 6)})`
    : parsed.host;

  return {
    url: baseUrl,
    token: rawToken,
    suggestedName,
    kind,
  };
}
