import { Workspace } from './workspace.models';

const DEFAULT_PROJECT_PATH = 'D:\\dev\\termexo';

export function createDefaultWorkspaces(): Workspace[] {
  const now = Date.now();

  return [
    {
      id: crypto.randomUUID(),
      name: 'Termexo',
      projectPath: DEFAULT_PROJECT_PATH,
      projectType: 'Angular + Rust',
      activeBranch: 'feature/terminal-runtime',
      favorite: true,
      lastOpenedAt: now,
      layout: 'columns',
      gridColumns: 2,
      gridRows: 2,
      terminals: [
        {
          id: crypto.randomUUID(),
          name: 'Claude - Core',
          workingDirectory: DEFAULT_PROJECT_PATH,
          shell: 'powershell.exe',
          agentType: 'claude',
          status: 'STARTING',
          model: 'Claude Sonnet',
          branch: 'feature/terminal-runtime',
          command: 'claude',
          nativeSessionId: 'claude-local-01',
        },
        {
          id: crypto.randomUUID(),
          name: 'Codex - Tests',
          workingDirectory: DEFAULT_PROJECT_PATH,
          shell: 'powershell.exe',
          agentType: 'codex',
          status: 'STARTING',
          model: 'GPT Codex',
          branch: 'feature/terminal-runtime',
          command: 'codex',
          nativeSessionId: 'codex-local-02',
        },
      ],
    },
    {
      id: crypto.randomUUID(),
      name: 'MTS Cloud',
      projectPath: 'D:\\dev\\mts-cloud',
      projectType: 'Angular + Java',
      activeBranch: 'main',
      favorite: true,
      lastOpenedAt: now - 3_600_000,
      layout: 'grid',
      gridColumns: 2,
      gridRows: 2,
      terminals: [],
    },
    {
      id: crypto.randomUUID(),
      name: 'Device Health',
      projectPath: 'D:\\dev\\device-health',
      projectType: 'Spring Boot',
      activeBranch: 'develop',
      favorite: false,
      lastOpenedAt: now - 86_400_000,
      layout: 'single',
      gridColumns: 2,
      gridRows: 2,
      terminals: [],
    },
  ];
}
