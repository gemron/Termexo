import { computed, Injectable, signal } from '@angular/core';

import {
  parseRemoteAccessLink,
  ProbeOutcome,
  ProbeRemoteHostRequest,
  RemoteHost,
  RemoteHostsSnapshot,
  RemoteHostStatus,
  SaveRemoteHostRequest,
} from '../models/remote-host.models';
import { createId } from '../models/identifiers';
import { invoke, listen } from './backend-bridge';
import { isTauriRuntime } from './tauri-runtime';

const PREVIEW_STORAGE_KEY = 'termexo.preview.remote-hosts';
const REMOTE_HOSTS_CHANGED_EVENT = 'remote-hosts-changed';

@Injectable({ providedIn: 'root' })
export class RemoteHostsService {
  private readonly hostsSignal = signal<RemoteHost[]>([]);
  private readonly statusesSignal = signal<RemoteHostStatus[]>([]);
  private readonly loadingSignal = signal(false);
  private initialized = false;

  readonly hosts = this.hostsSignal.asReadonly();
  readonly statuses = this.statusesSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();

  readonly statusMap = computed(() => {
    const map = new Map<string, RemoteHostStatus>();
    for (const status of this.statusesSignal()) {
      map.set(status.hostId, status);
    }
    return map;
  });

  readonly onlineCount = computed(
    () => this.statusesSignal().filter((status) => status.health === 'online').length,
  );

  readonly openCount = computed(
    () => this.statusesSignal().filter((status) => status.open).length,
  );

  constructor() {
    if (isTauriRuntime()) {
      void listen<RemoteHostsSnapshot>(REMOTE_HOSTS_CHANGED_EVENT, (event) => {
        this.applySnapshot(event.payload);
      });
    }
  }

  async ensureLoaded(): Promise<RemoteHostsSnapshot> {
    if (!this.initialized) {
      this.initialized = true;
      return this.load();
    }
    return {
      hosts: this.hostsSignal(),
      statuses: this.statusesSignal(),
    };
  }

  async load(): Promise<RemoteHostsSnapshot> {
    if (!isTauriRuntime()) {
      const snapshot = this.loadPreviewSnapshot();
      this.applySnapshot(snapshot);
      return snapshot;
    }
    this.loadingSignal.set(true);
    try {
      const snapshot = await invoke<RemoteHostsSnapshot>('list_remote_hosts');
      this.applySnapshot(snapshot);
      return snapshot;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  async refreshAll(): Promise<RemoteHostsSnapshot> {
    if (!isTauriRuntime()) {
      const snapshot = this.loadPreviewSnapshot();
      this.applySnapshot(snapshot);
      return snapshot;
    }
    this.loadingSignal.set(true);
    try {
      const snapshot = await invoke<RemoteHostsSnapshot>('refresh_remote_hosts');
      this.applySnapshot(snapshot);
      return snapshot;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  async saveHost(request: SaveRemoteHostRequest): Promise<RemoteHostsSnapshot> {
    if (!isTauriRuntime()) {
      return this.savePreviewHost(request);
    }
    const snapshot = await invoke<RemoteHostsSnapshot>('save_remote_host', { request });
    this.applySnapshot(snapshot);
    return snapshot;
  }

  async deleteHost(hostId: string): Promise<RemoteHostsSnapshot> {
    if (!isTauriRuntime()) {
      const current = this.hostsSignal().filter((host) => host.id !== hostId);
      this.storePreviewHosts(current);
      const snapshot = this.loadPreviewSnapshot();
      this.applySnapshot(snapshot);
      return snapshot;
    }
    const snapshot = await invoke<RemoteHostsSnapshot>('delete_remote_host', { hostId });
    this.applySnapshot(snapshot);
    return snapshot;
  }

  async reorderHosts(hostIds: string[]): Promise<RemoteHostsSnapshot> {
    if (!isTauriRuntime()) {
      return { hosts: this.hostsSignal(), statuses: this.statusesSignal() };
    }
    const snapshot = await invoke<RemoteHostsSnapshot>('reorder_remote_hosts', { hostIds });
    this.applySnapshot(snapshot);
    return snapshot;
  }

  async probeHost(request: ProbeRemoteHostRequest): Promise<ProbeOutcome> {
    if (!isTauriRuntime()) {
      return {
        health: 'online',
        version: '0.12.1',
        latencyMs: 14,
        readOnly: false,
        error: null,
      };
    }
    return invoke<ProbeOutcome>('probe_remote_host', { request });
  }

  async openHost(hostId: string): Promise<RemoteHostsSnapshot> {
    if (!isTauriRuntime()) {
      const host = this.hostsSignal().find((item) => item.id === hostId);
      if (host && typeof window !== 'undefined') {
        window.open(host.url, '_blank', 'noopener,noreferrer');
      }
      return { hosts: this.hostsSignal(), statuses: this.statusesSignal() };
    }
    const snapshot = await invoke<RemoteHostsSnapshot>('open_remote_host', { hostId });
    this.applySnapshot(snapshot);
    return snapshot;
  }

  async closeHost(hostId: string): Promise<RemoteHostsSnapshot> {
    if (!isTauriRuntime()) {
      return { hosts: this.hostsSignal(), statuses: this.statusesSignal() };
    }
    const snapshot = await invoke<RemoteHostsSnapshot>('close_remote_host', { hostId });
    this.applySnapshot(snapshot);
    return snapshot;
  }

  private applySnapshot(snapshot: RemoteHostsSnapshot): void {
    this.hostsSignal.set(snapshot.hosts);
    this.statusesSignal.set(snapshot.statuses);
  }

  private loadPreviewSnapshot(): RemoteHostsSnapshot {
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PREVIEW_STORAGE_KEY);
      const hosts: RemoteHost[] = raw ? (JSON.parse(raw) as RemoteHost[]) : [];
      const statuses: RemoteHostStatus[] = hosts.map((host) => ({
        hostId: host.id,
        health: 'online',
        version: '0.12.1',
        latencyMs: 12,
        checkedAt: Date.now(),
        error: null,
        open: false,
      }));
      return { hosts, statuses };
    } catch {
      return { hosts: [], statuses: [] };
    }
  }

  private savePreviewHost(request: SaveRemoteHostRequest): RemoteHostsSnapshot {
    const parsed = parseRemoteAccessLink(request.url);
    const normalizedUrl = parsed?.url ?? request.url.trim();
    const kind = parsed?.kind ?? 'lan';
    const current = [...this.hostsSignal()];
    const existingIndex = request.id ? current.findIndex((item) => item.id === request.id) : -1;
    if (existingIndex >= 0) {
      current[existingIndex] = {
        ...current[existingIndex],
        name: request.name.trim(),
        url: normalizedUrl,
        kind,
        group: request.group?.trim() || null,
        color: request.color?.trim() || null,
      };
    } else {
      current.push({
        id: createId(),
        name: request.name.trim(),
        url: normalizedUrl,
        kind,
        readOnly: false,
        group: request.group?.trim() || null,
        color: request.color?.trim() || null,
        sortOrder: current.length,
        createdAt: Date.now(),
        lastConnectedAt: null,
      });
    }
    this.storePreviewHosts(current);
    const snapshot = this.loadPreviewSnapshot();
    this.applySnapshot(snapshot);
    return snapshot;
  }

  private storePreviewHosts(hosts: RemoteHost[]): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(hosts));
      }
    } catch {
      // Ignore storage errors in browser preview.
    }
  }
}
