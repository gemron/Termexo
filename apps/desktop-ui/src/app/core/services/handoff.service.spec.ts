import { HandoffService } from './handoff.service';
import { buildHandoffPackage, type HandoffPackage, type HandoffRecord } from '../models/handoff';

const STORAGE_KEY = 'termexo.handoffPackages.v1';

describe('handoff history updates in browser preview', () => {
  let service: HandoffService;
  let handoff: HandoffPackage;
  let record: HandoffRecord;
  beforeEach(async () => {
    handoff = buildHandoffPackage({
      workspace: {
        id: 'source-workspace',
        name: 'Source',
        projectPath: 'D:/source',
        projectType: '',
        activeBranch: 'main',
        favorite: false,
        lastOpenedAt: 1,
        layout: 'single',
        terminals: [],
      },
      terminals: [],
      scope: 'workspace',
      promptAssets: [],
      agentSessions: [],
      outputByTerminal: new Map(),
      tokenBudget: 8000,
      now: 10,
      id: 'history-test',
      git: {
        available: false,
        branch: '',
        status: '',
        changedFiles: [],
        diff: '',
        recentCommits: [],
        truncated: false,
        diagnostic: '',
      },
    });
    record = {
      id: handoff.id,
      workspaceId: 'importing-workspace',
      title: handoff.title,
      packageJson: JSON.stringify(handoff),
      createdAt: 10,
      updatedAt: 20,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([record]));
    service = new HandoffService();
    await service.initialize();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('persists sanitized edits across reloads without moving an imported record', async () => {
    const saved = await service.updatePackage({
      ...handoff,
      task: 'Fix api_key=abcdefghijklmnop',
      nextAction: 'Run regression tests',
    });
    expect(saved.task).not.toContain('abcdefghijklmnop');
    expect(saved.redactions).toBeGreaterThan(0);
    const reloaded = new HandoffService();
    await reloaded.initialize();
    expect(reloaded.forWorkspace('source-workspace')).toHaveLength(0);
    const records = reloaded.forWorkspace('importing-workspace');
    expect(records).toHaveLength(1);
    expect(records[0].createdAt).toBe(10);
    expect(records[0].updatedAt).toBeGreaterThan(20);
    expect((await reloaded.packageFromRecord(records[0])).nextAction).toBe('Run regression tests');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('abcdefghijklmnop');
  });

  it('keeps previous history intact and reports a storage failure', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    await expect(service.updatePackage({ ...handoff, task: 'Unsaved edit' })).rejects.toThrow(
      'Storage full',
    );
    expect(service.records()).toEqual([record]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([record]);
    expect(service.error()).toBe('Storage full');
    expect(service.busy()).toBe(false);
  });

  it('does not recreate a history entry that has been deleted', async () => {
    await service.delete(handoff.id);
    await expect(service.updatePackage(handoff)).rejects.toThrow('no longer in history');
    expect(service.records()).toHaveLength(0);
  });
});
