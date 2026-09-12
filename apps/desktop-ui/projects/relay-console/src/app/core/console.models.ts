/**
 * The shapes `/api/*` speaks.
 *
 * They mirror the relay's serialization exactly — camelCase fields, timestamps as epoch
 * milliseconds — so nothing in this app has to translate between two vocabularies.
 */

export type UserRole = 'admin' | 'user';
export type DeviceKind = 'desktop' | 'relay';
export type EnrollmentStatus = 'pending' | 'used' | 'expired' | 'cancelled';
export type UpstreamState = 'disabled' | 'connecting' | 'connected' | 'error';
export type AuditActorKind = 'user' | 'device' | 'system';

export interface UserView {
  id: string;
  username: string;
  role: UserRole;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  deviceCount: number;
}

export interface DeviceView {
  id: string;
  kind: DeviceKind;
  name: string;
  ownerUserId: string | null;
  ownerUsername: string | null;
  online: boolean;
  connectedSince: number | null;
  lastSeenAt: number | null;
  lastIp: string | null;
  lastVersion: string | null;
  /** Relay ids the device is reached through; empty when it is connected to this relay directly. */
  via: string[];
  viaNames: string[];
  revokedAt: number | null;
  note: string | null;
  /** Public address of the device, without the desktop's access token. */
  accessUrl: string;
}

export interface EnrollmentView {
  id: string;
  kind: DeviceKind;
  ownerUserId: string | null;
  ownerUsername: string | null;
  note: string | null;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedByDeviceId: string | null;
  status: EnrollmentStatus;
}

export interface UpstreamView {
  url: string;
  state: UpstreamState;
  relayId: string | null;
  /** Relay ids from this relay's upstream all the way to the top of the chain. */
  chain: string[];
  error: string | null;
}

export interface DownstreamView {
  deviceId: string;
  name: string;
  online: boolean;
  deviceCount: number;
}

export interface RelayTopology {
  upstream: UpstreamView | null;
  downstreams: DownstreamView[];
}

export interface AuditView {
  id: number;
  at: number;
  actorKind: AuditActorKind;
  actorId: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  ip: string | null;
  detail: string | null;
}

export interface RelaySettingsView {
  relayId: string;
  publicUrl: string;
  version: string;
}

export interface HealthView {
  version: string;
  relayId: string;
  protocol: number;
}

/** Fields a device's owner or an administrator may change. */
export interface DevicePatch {
  name?: string;
  note?: string;
}

export interface UserPatch {
  disabled?: boolean;
  role?: UserRole;
  password?: string;
}

export interface NewUser {
  username: string;
  password: string;
  role: UserRole;
}

export interface NewEnrollment {
  kind: DeviceKind;
  ownerUserId?: string;
  ttlMinutes?: number;
  note?: string;
}

/** The code is returned exactly once, when the enrolment is created, and never stored plainly. */
export interface CreatedEnrollment {
  enrollment: EnrollmentView;
  code: string;
}

export interface AuditQuery {
  limit?: number;
  before?: number;
  targetId?: string;
}
