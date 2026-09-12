import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  AuditQuery,
  AuditView,
  CreatedEnrollment,
  DevicePatch,
  DeviceView,
  EnrollmentView,
  HealthView,
  NewEnrollment,
  NewUser,
  RelaySettingsView,
  RelayTopology,
  UpstreamView,
  UserPatch,
  UserView,
} from './console.models';

/**
 * Relative on purpose: the console is always served by the relay it administers, so it needs no
 * host configuration and works behind any reverse proxy the operator puts in front of it.
 */
export const API_BASE = '/api/';

/** The login endpoint, which the interceptor must not turn into a redirect of its own. */
export const LOGIN_ENDPOINT = `${API_BASE}auth/login`;

/**
 * Every call the relay console makes.
 *
 * Pages never touch `HttpClient` themselves: keeping the URLs and the response envelopes here is
 * what lets a contract change stay a one-file change.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleApiService {
  private readonly http = inject(HttpClient);

  health(): Promise<HealthView> {
    return this.get<HealthView>('health');
  }

  signIn(username: string, password: string): Promise<UserView> {
    return this.post<{ user: UserView }>('auth/login', { username, password }).then(
      (body) => body.user,
    );
  }

  signOut(): Promise<void> {
    return this.post<void>('auth/logout', {});
  }

  me(): Promise<UserView> {
    return this.get<{ user: UserView }>('me').then((body) => body.user);
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.post<void>('me/password', { currentPassword, newPassword });
  }

  listUsers(): Promise<UserView[]> {
    return this.get<{ users: UserView[] }>('admin/users').then((body) => body.users);
  }

  createUser(user: NewUser): Promise<UserView> {
    return this.post<{ user: UserView }>('admin/users', user).then((body) => body.user);
  }

  updateUser(id: string, patch: UserPatch): Promise<UserView> {
    return this.patch<{ user: UserView }>(`admin/users/${encodeURIComponent(id)}`, patch).then(
      (body) => body.user,
    );
  }

  deleteUser(id: string): Promise<void> {
    return this.delete<void>(`admin/users/${encodeURIComponent(id)}`);
  }

  /** Every device on the relay; only an administrator may ask for this. */
  listAllDevices(): Promise<DeviceView[]> {
    return this.get<{ devices: DeviceView[] }>('admin/devices').then((body) => body.devices);
  }

  /** The signed-in user's own devices. */
  listOwnDevices(): Promise<DeviceView[]> {
    return this.get<{ devices: DeviceView[] }>('devices').then((body) => body.devices);
  }

  updateDevice(id: string, patch: DevicePatch, asAdmin: boolean): Promise<DeviceView> {
    const path = asAdmin
      ? `admin/devices/${encodeURIComponent(id)}`
      : `devices/${encodeURIComponent(id)}`;
    return this.patch<{ device: DeviceView }>(path, patch).then((body) => body.device);
  }

  revokeDevice(id: string, asAdmin: boolean): Promise<DeviceView> {
    const path = asAdmin
      ? `admin/devices/${encodeURIComponent(id)}/revoke`
      : `devices/${encodeURIComponent(id)}/revoke`;
    return this.post<{ device: DeviceView }>(path, {}).then((body) => body.device);
  }

  disconnectDevice(id: string): Promise<void> {
    return this.post<void>(`admin/devices/${encodeURIComponent(id)}/disconnect`, {});
  }

  listEnrollments(): Promise<EnrollmentView[]> {
    return this.get<{ enrollments: EnrollmentView[] }>('admin/enrollments').then(
      (body) => body.enrollments,
    );
  }

  createEnrollment(request: NewEnrollment): Promise<CreatedEnrollment> {
    return this.post<CreatedEnrollment>('admin/enrollments', request);
  }

  cancelEnrollment(id: string): Promise<void> {
    return this.delete<void>(`admin/enrollments/${encodeURIComponent(id)}`);
  }

  relayTopology(): Promise<RelayTopology> {
    return this.get<RelayTopology>('admin/relays');
  }

  connectUpstream(url: string, code: string): Promise<UpstreamView> {
    return this.post<{ upstream: UpstreamView }>('admin/relays/upstream', { url, code }).then(
      (body) => body.upstream,
    );
  }

  disconnectUpstream(): Promise<void> {
    return this.delete<void>('admin/relays/upstream');
  }

  listAudit(query: AuditQuery = {}): Promise<AuditView[]> {
    let params = new HttpParams();
    if (query.limit !== undefined) params = params.set('limit', query.limit);
    if (query.before !== undefined) params = params.set('before', query.before);
    if (query.targetId) params = params.set('targetId', query.targetId);
    return this.get<{ events: AuditView[] }>('admin/audit', params).then((body) => body.events);
  }

  relaySettings(): Promise<RelaySettingsView> {
    return this.get<RelaySettingsView>('admin/settings');
  }

  private get<T>(path: string, params?: HttpParams): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${API_BASE}${path}`, { params }));
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${API_BASE}${path}`, body));
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(`${API_BASE}${path}`, body));
  }

  private delete<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${API_BASE}${path}`));
  }
}
