import { Injectable } from '@angular/core';
import { invoke } from './backend-bridge';
import { hasBackend } from './tauri-runtime';

export interface CodexModelCatalog {
  source: string;
  configuredDefault: string | null;
  models: { id: string; displayName: string; isDefault: boolean; supportedReasoningEfforts: string[]; defaultReasoningEffort?: string }[];
}

@Injectable({ providedIn: 'root' })
export class CodexModelCatalogService {
  private readonly pending = new Map<string, Promise<CodexModelCatalog>>();
  load(accountProfileId: string, workingDirectory: string, refresh = false): Promise<CodexModelCatalog> {
    if (!hasBackend()) return Promise.resolve({ source: 'unavailable', configuredDefault: null, models: [] });
    const key = JSON.stringify([accountProfileId, workingDirectory]);
    if (refresh) this.pending.delete(key);
    let request = this.pending.get(key);
    if (!request) {
      request = invoke<CodexModelCatalog>('list_codex_models', { accountProfileId: accountProfileId || null, workingDirectory: workingDirectory || null });
      this.pending.set(key, request);
      // Deduplicate concurrent callers; do not keep stale catalogs across future dialog opens.
      void request.finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); }).catch(() => {});
    }
    return request;
  }
}
