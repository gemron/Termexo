import { invoke as desktopInvoke } from '@tauri-apps/api/core';
import { listen as desktopListen } from '@tauri-apps/api/event';

import type { RemoteBridgeClient } from './remote-bridge-client';
import { runtimeMode } from './tauri-runtime';

export type UnlistenFn = () => void;

export interface BackendEvent<T> {
  event: string;
  payload: T;
}

const PREVIEW_ERROR = '仅桌面应用可用';

/**
 * Loads the WebSocket bridge only where it is used.
 *
 * Keeping it behind a dynamic import leaves the desktop bundle — which is already close to its
 * size budget — free of transport code it can never reach.
 */
export async function getRemoteClient(): Promise<RemoteBridgeClient> {
  return (await import('./remote-bridge-client')).remoteBridgeClient();
}

/**
 * Calls a backend command over whichever transport this runtime has.
 *
 * Services import this instead of `@tauri-apps/api/core` so the same code serves the desktop
 * WebView and a remote browser without knowing which one it runs in.
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  switch (runtimeMode()) {
    case 'desktop':
      return desktopInvoke<T>(command, args);
    case 'remote':
      return (await getRemoteClient()).invoke<T>(command, args);
    default:
      throw new Error(PREVIEW_ERROR);
  }
}

/** Subscribes to a backend event, mirroring the shape of the Tauri `listen` callback. */
export async function listen<T>(
  event: string,
  handler: (event: BackendEvent<T>) => void,
): Promise<UnlistenFn> {
  switch (runtimeMode()) {
    case 'desktop':
      return desktopListen<T>(event, handler);
    case 'remote':
      return (await getRemoteClient()).listen<T>(event, handler);
    default:
      return () => undefined;
  }
}
