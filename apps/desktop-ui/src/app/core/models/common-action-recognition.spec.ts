import { expect, it } from 'vitest';
import { recognitionPrompt } from './common-action-recognition';

it('asks the agent to confirm the host shell instead of prescribing Windows commands', () => {
  const prompt = recognitionPrompt('/home/user/project', 'workspace', 'request');
  expect(prompt).toContain('Linux/Bash');
  expect(prompt).toContain('先只读确认');
  expect(prompt).not.toContain('当前 Windows PowerShell');
  expect(prompt).toContain('不要修改文件');
});
