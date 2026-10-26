import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Workflow } from './protocol.js';

export function defaultStateDirectory(): string { return process.env.ONE_RING_STATE_DIR || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'one-ring'); }
export class Store {
  readonly db: DatabaseSync;
  constructor(readonly directory = defaultStateDirectory()) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, 'state.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > 1) throw new Error('State was written by a newer One Ring version; refusing to overwrite it.');
    this.db.exec(`CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, root TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, time TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(root TEXT PRIMARY KEY, workflow_id TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  get(id: string): Workflow {
    const row = this.db.prepare('SELECT data FROM workflows WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new Error('Unknown workflow.');
    const workflow = JSON.parse(row.data) as Workflow;
    if (workflow.id !== id || !Array.isArray(workflow.runs) || typeof workflow.revision !== 'number') throw new Error('Corrupt workflow state; preserving the record.');
    return workflow;
  }
  list(): Workflow[] { return (this.db.prepare('SELECT id FROM workflows ORDER BY rowid DESC').all() as { id: string }[]).map(row => this.get(row.id)); }
  create(workflow: Workflow): Workflow {
    return this.transaction(() => {
      const active = this.list().find(w => w.root === workflow.root && !['COMPLETED', 'CANCELLED', 'FAILED'].includes(w.phase));
      if (active) throw new Error(`Workspace already has active workflow ${active.id}.`);
      this.db.prepare('INSERT INTO workflows(id,root,data) VALUES(?,?,?)').run(workflow.id, workflow.root, JSON.stringify(workflow));
      this.event(workflow.id, 'workflow.created', { planHash: workflow.plan.hash });
      return workflow;
    });
  }
  update(id: string, type: string, edit: (workflow: Workflow) => void, expectedRevision?: number): Workflow {
    return this.transaction(() => {
      const workflow = this.get(id);
      if (expectedRevision !== undefined && expectedRevision !== workflow.revision) throw new Error('Workflow changed while awaiting a decision; inspect the current version.');
      edit(workflow);
      workflow.revision += 1;
      workflow.updatedAt = new Date().toISOString();
      this.db.prepare('UPDATE workflows SET data=? WHERE id=?').run(JSON.stringify(workflow), id);
      this.event(id, type, { phase: workflow.phase, revision: workflow.revision });
      return workflow;
    });
  }
  acquire(root: string, id: string): void {
    const lease = this.db.prepare('SELECT workflow_id FROM leases WHERE root=?').get(root) as { workflow_id: string } | undefined;
    if (lease && lease.workflow_id !== id) throw new Error('Another workflow holds the workspace execution lease.');
    if (!lease) this.db.prepare('INSERT INTO leases(root,workflow_id) VALUES(?,?)').run(root, id);
  }
  release(root: string, id: string): void { this.db.prepare('DELETE FROM leases WHERE root=? AND workflow_id=?').run(root, id); }
  event(id: string, type: string, payload: unknown): void { this.db.prepare('INSERT INTO events(workflow_id,time,type,payload) VALUES(?,?,?,?)').run(id, new Date().toISOString(), type, JSON.stringify(payload)); }
  events(id: string, after = 0): unknown[] { return (this.db.prepare('SELECT * FROM events WHERE workflow_id=? AND seq>? ORDER BY seq LIMIT 200').all(id, after) as Record<string, unknown>[]).map(row => ({ ...row, payload: JSON.parse(String(row.payload)) })); }
  private transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  close(): void { this.db.close(); }
}
