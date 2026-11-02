import { createId } from './identifiers';
import { Workspace } from './workspace.models';
import { previewShellSyntax } from './shell-command';

const WINDOWS_PREVIEW = previewShellSyntax() === 'powershell';
const DEFAULT_PROJECT_PATH = WINDOWS_PREVIEW ? 'D:\\dev\\termexo' : '/home/demo/termexo';
const DEFAULT_PREVIEW_SHELL = WINDOWS_PREVIEW ? 'powershell.exe' : '/bin/bash';

export function createDefaultWorkspaces(): Workspace[] {
  const now = Date.now();

  return [
    {
      id: createId(),
      name: 'Termexo',
      themeColor: '#58c7a0',
      sortOrder: 0,
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
          id: createId(),
          name: 'Claude - Core',
          workingDirectory: DEFAULT_PROJECT_PATH,
          shell: DEFAULT_PREVIEW_SHELL,
          agentType: 'claude',
          status: 'STARTING',
          model: 'Claude Sonnet',
          branch: 'feature/terminal-runtime',
          command: 'claude',
          nativeSessionId: 'claude-local-01',
        },
        {
          id: createId(),
          name: 'Codex - Tests',
          workingDirectory: DEFAULT_PROJECT_PATH,
          shell: DEFAULT_PREVIEW_SHELL,
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
      id: createId(),
      name: 'MTS Cloud',
      themeColor: '#a78bfa',
      sortOrder: 1,
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
      id: createId(),
      name: 'Device Health',
      themeColor: '#68a9e8',
      sortOrder: 2,
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
