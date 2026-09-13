export type SettingsProfileKind = 'models' | 'accounts' | 'mcp' | 'network';
export interface ProfileSaveCompleted {
  kind: SettingsProfileKind;
  id: string;
}

/** Dialog-lifetime drafts only; credentials never go to browser storage. */
export class ProfileDrafts<T extends object> {
  private readonly drafts = new Map<string, T>();
  private readonly baselines = new Map<string, string>();
  private readonly pending = new Map<string, T>();
  private knownIds = new Set<string>();
  private initialized = false;
  private ready = false;

  remember(id: string, value: T): void {
    if (this.ready) this.drafts.set(id, { ...value });
  }

  restore(id: string, persisted: T): T {
    if (!this.baselines.has(id)) this.baselines.set(id, JSON.stringify(persisted));
    this.ready = true;
    return { ...(this.drafts.get(id) ?? persisted) };
  }

  dirty(id: string, value: T): boolean {
    return this.ready && JSON.stringify(value) !== this.baselines.get(id);
  }

  hasChanges(): boolean {
    return [...this.drafts].some(([id, value]) => this.dirty(id, value));
  }

  beginSave(previousId: string, id: string, value: T): void {
    if (previousId !== id) {
      // An unedited default is still unsaved when its first creation request fails.
      this.baselines.set(id, previousId ? (this.baselines.get(previousId) ?? '') : '');
      this.baselines.delete(previousId);
      this.drafts.delete(previousId);
    }
    this.drafts.set(id, { ...value });
    this.pending.set(id, { ...value });
  }

  /** Reconcile each field so a successful credential save does not erase newer edits. */
  acknowledge(id: string, cleanSaved: (value: T) => T): T | undefined {
    const submitted = this.pending.get(id);
    if (!submitted) return undefined;
    const clean = cleanSaved(submitted);
    const current = this.drafts.get(id) ?? submitted;
    const merged = { ...current };
    for (const key of Object.keys(submitted) as (keyof T)[]) {
      if (Object.is(current[key], submitted[key])) merged[key] = clean[key];
    }
    this.baselines.set(id, JSON.stringify(clean));
    this.drafts.set(id, merged);
    this.pending.delete(id);
    return { ...merged };
  }

  /** Select a fallback only on initial loading or deletion, never merely on a refresh. */
  reconcile(ids: string[], selectedId: string, current: T): boolean {
    const next = new Set(ids);
    const firstProfilesArrived = this.knownIds.size === 0 && next.size > 0;
    const removed = [...this.knownIds].filter((id) => !next.has(id));
    for (const id of removed) {
      this.drafts.delete(id);
      this.baselines.delete(id);
      this.pending.delete(id);
    }
    const choose =
      !this.initialized ||
      removed.includes(selectedId) ||
      (firstProfilesArrived && !selectedId && !this.dirty(selectedId, current));
    if (removed.includes(selectedId)) this.ready = false;
    this.knownIds = next;
    this.initialized = true;
    return choose;
  }
}
