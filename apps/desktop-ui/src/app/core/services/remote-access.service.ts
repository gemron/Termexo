import { Injectable } from '@angular/core';

import {
  QrCodeImage,
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

  /** Builds the link another device opens, with the token in the fragment so it never hits a log. */
  buildUrl(address: string, port: number, tls: boolean, token: string): string {
    const host = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
    return `${tls ? 'https' : 'http'}://${host}:${port}/#token=${encodeURIComponent(token)}`;
  }
}
