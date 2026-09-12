import type { DeviceView } from '../core/console.models';

/** Colour families the status dot uses; the word beside it always carries the same meaning. */
export type StatusTone = 'neutral' | 'online' | 'warning' | 'danger';

export interface StatusView {
  tone: StatusTone;
  /** Translation key for the word shown next to the dot. */
  key: string;
}

/**
 * One reading of a device's state.
 *
 * Revoked wins over online: a revoked device may still show a stale connection for a moment, and
 * "online" would be the wrong thing to tell the operator who just revoked it.
 */
export function deviceStatus(device: DeviceView): StatusView {
  if (device.revokedAt) {
    return { tone: 'danger', key: 'console.devices.revoked' };
  }
  return device.online
    ? { tone: 'online', key: 'console.devices.online' }
    : { tone: 'neutral', key: 'console.devices.offline' };
}
