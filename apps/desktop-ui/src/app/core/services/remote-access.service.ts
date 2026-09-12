import { Injectable } from '@angular/core';

import {
  QrCodeImage,
  RelayAddress,
  RelayEnrollRequest,
  RemoteAccessSettings,
  RemoteAccessStatus,
} from '../models/remote-access.models';
import { invoke } from './backend-bridge';

@Injectable({ providedIn: 'root' })
export class RemoteAccessService {
  getStatus(): Promise<RemoteAccessStatus> {
    return invoke<RemoteAccessStatus>('get_remote_access_status');
  }

  updateSettings(settings: RemoteAccessSettings): Promise<RemoteAccessStatus> {
    return invoke<RemoteAccessStatus>('update_remote_access_settings', { settings });
  }

  regenerateToken(): Promise<RemoteAccessStatus> {
    return invoke<RemoteAccessStatus>('regenerate_remote_access_token');
  }

  renderQr(url: string): Promise<QrCodeImage> {
    return invoke<QrCodeImage>('render_remote_access_qr', { url });
  }

  /**
   * Trades an enrollment code or a relay account for a device credential.
   *
   * The credential itself stays in the backend's keyring; only the resulting status comes back.
   */
  enrollRelayDevice(request: RelayEnrollRequest): Promise<RemoteAccessStatus> {
    return invoke<RemoteAccessStatus>('enroll_relay_device', { request });
  }

  /** Drops the tunnel and forgets the device credential, so the relay can no longer reach here. */
  disconnectRelay(): Promise<RemoteAccessStatus> {
    return invoke<RemoteAccessStatus>('disconnect_relay');
  }

  /** Builds the link another device opens, with the token in the fragment so it never hits a log. */
  buildUrl(address: string, port: number, tls: boolean, token: string): string {
    const host = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
    return `${tls ? 'https' : 'http'}://${host}:${port}/#token=${encodeURIComponent(token)}`;
  }

  /** Same link, for an address the relay announced; its url already ends with a slash. */
  buildRelayUrl(address: RelayAddress, token: string): string {
    return `${address.url}#token=${encodeURIComponent(token)}`;
  }
}
