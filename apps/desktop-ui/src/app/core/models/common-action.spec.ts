import { describe, expect, it } from 'vitest';
import {
  commonActionSignature,
  commonActionState,
  commonActionTerminal,
  parseActionSuggestions,
  relativeActionDirectory,
  validateCommonAction,
} from './common-action';
import { recognitionPrompt } from './common-action-recognition';
import type { CommonAction, TerminalSession } from './workspace.models';

const action: CommonAction = {
  id: 'build',
  name: '构建',
  command: 'npm run build',
  workingDirectory: 'D:/Project',
  description: '生成生产产物',
};

describe('common action validation and identity', () => {
  it('fills omitted AI directories and resolves project-relative paths on the host platform', () => {
    const suggestion = (workingDirectory?: string) => JSON.stringify([{ name: 'Dev', command: 'npm run dev', workingDirectory }]);
    expect(parseActionSuggestions(suggestion(), 'D:/项目 with spaces')[0].workingDirectory).toBe('D:/项目 with spaces');
    for (const [base, relative, expected] of [
      ['D:/project', './apps/web/../api', 'D:/project/apps/api'],
      ['D:\\project', '.\\apps\\web', 'D:/project/apps/web'],
      ['D:/project', '\\web', 'D:/web'],
      ['/home/project', './apps/web', '/home/project/apps/web'],
      ['/home/project', '../shared', '/home/shared'],
      ['\\\\server\\share\\project', '../../api', '//server/share/api'],
    ]) expect(parseActionSuggestions(suggestion(relative), base)[0].workingDirectory).toBe(expected);
    expect(parseActionSuggestions(suggestion('/srv/api'), '/home/project')[0].workingDirectory).toBe('/srv/api');
    for (const unresolved of ['$PWD/web', '${workspaceFolder}/web', './${workspaceFolder}/web', 'apps/%APP%/web', '~/web', '%PROJECT%/web', 'D:web', 'web\0/..'])
      expect(() => parseActionSuggestions(suggestion(unresolved), 'D:/project')).toThrow('第 1 项');
    expect(() => validateCommonAction({ ...action, workingDirectory: './web' })).toThrow('绝对路径');
  });
  it('preserves literal environment values and distinguishes the same command under different environments', () => {
    const environment = { NODE_ENV: 'development', PORT: ' 4300 ', EMPTY: '', VALUE: "a=b $HOME 'quoted'\nnext" };
    expect(validateCommonAction({ ...action, environment }).environment).toEqual(environment);
    expect(commonActionSignature({ ...action, environment: { A: '1', B: '2' } })).toBe(
      commonActionSignature({ ...action, environment: { B: '2', A: '1' } }));
    expect(commonActionSignature({ ...action, environment: { PORT: '4300' } })).not.toBe(
      commonActionSignature({ ...action, environment: { PORT: '4400' } }));
    expect(commonActionSignature({ ...action, environment: {} })).toBe(commonActionSignature(action));
  });

  it('rejects malformed process environments before saving or accepting suggestions', () => {
    for (const environment of [{ 'bad-name': 'value' }, { PORT: 4300 }, { PORT: 'a\0b' }, ['A=1'],
      Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`VAR_${i}`, 'x']))]) {
      expect(() => validateCommonAction({ ...action, environment })).toThrow('环境变量');
    }
  });
  it('accepts legacy actions and retains valid categories while dropping runtime bindings', () => {
    expect(validateCommonAction(action)).not.toHaveProperty('category');
    expect(validateCommonAction({ ...action, category: 'build', terminalId: 'foreign' })).toEqual({
      name: action.name,
      command: action.command,
      workingDirectory: action.workingDirectory,
      description: action.description,
      category: 'build',
    });
    expect(() => validateCommonAction({ ...action, category: 'unknown' })).toThrow('分类');
  });

  it('accepts fenced JSON and identifies the invalid suggestion without partially accepting a batch', () => {
    expect(parseActionSuggestions('```json\n' + JSON.stringify([action]) + '\n```')).toHaveLength(
      1,
    );
    expect(() => parseActionSuggestions(JSON.stringify([action, { ...action, name: '' }]))).toThrow(
      '第 2 项：请填写名称',
    );
    expect(() => parseActionSuggestions('文字说明\n' + JSON.stringify([action]))).toThrow(
      '完整的 JSON',
    );
    expect(() => parseActionSuggestions(JSON.stringify(Array(21).fill(action)))).toThrow('20 项');
  });

  it('deduplicates Windows directories without merging distinct POSIX directories or altering commands', () => {
    expect(
      commonActionSignature({
        ...action,
        workingDirectory: 'd:\\project\\',
        command: ' npm run build ',
      }),
    ).toBe(commonActionSignature(action));
    expect(commonActionSignature({ ...action, workingDirectory: '/Project' })).not.toBe(
      commonActionSignature({ ...action, workingDirectory: '/project' }),
    );
    expect(commonActionSignature({ ...action, command: 'npm run Build' })).not.toBe(
      commonActionSignature(action),
    );
    expect(relativeActionDirectory('D:\\Project\\Web', 'd:/project/')).toBe('./Web');
    expect(relativeActionDirectory('/Project/Web', '/project')).toBe('/Project/Web');
    expect(relativeActionDirectory('/web', '/')).toBe('./web');
  });
});

describe('common action runtime presentation', () => {
  it('distinguishes starting, completed, failed and stopped and never binds an unrelated terminal', () => {
    const terminal = { id: 't', commonActionId: 'build', status: 'COMPLETED' } as TerminalSession;
    expect(commonActionState()).toBe('unstarted');
    expect(commonActionState(terminal)).toBe('completed');
    expect(commonActionState({ ...terminal, status: 'STARTING' })).toBe('starting');
    expect(commonActionState({ ...terminal, status: 'FAILED' })).toBe('failed');
    expect(commonActionState({ ...terminal, status: 'STOPPED' })).toBe('stopped');
    expect(commonActionTerminal({ ...action, terminalId: 't' }, [terminal])).toBe(terminal);
    expect(
      commonActionTerminal({ ...action, id: 'other', terminalId: 't' }, [terminal]),
    ).toBeUndefined();
  });

  it('requests commands for the project host and evidence-based workflows', () => {
    expect(recognitionPrompt('D:/project', 'w', 'r')).toContain('Windows PowerShell 5.1');
    const posix = recognitionPrompt('/Users/project', 'w', 'r');
    expect(posix).toContain('实际终端 shell');
    expect(posix).toContain('不要仅根据保存的路径或 shell 名称推断平台');
    expect(posix).not.toContain('当前 Windows PowerShell');
    expect(posix).toContain('category');
    expect(posix).toContain('packageManager');
  });
});
