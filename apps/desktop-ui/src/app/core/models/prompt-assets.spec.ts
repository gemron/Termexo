import { describe, expect, it } from 'vitest';

import {
  promptAssetMatches,
  redactSensitiveContent,
  TerminalPromptCapture,
  type PromptAsset,
} from './prompt-assets';

describe('TerminalPromptCapture', () => {
  it('captures edits and commits a prompt without mixing terminal output', () => {
    const capture = new TerminalPromptCapture();

    capture.consume('helo');
    capture.consume('\u001b[D');
    capture.consume('l');
    const result = capture.consume('\r');

    expect(result.submitted).toEqual(['hello']);
    expect(result.draft).toBe('');
  });

  it('keeps newlines inside bracketed paste until the final submit', () => {
    const capture = new TerminalPromptCapture();
    capture.consume('\u001b[200~first\nsecond\u001b[201~');

    expect(capture.draft).toBe('first\nsecond');
    expect(capture.consume('\r').submitted).toEqual(['first\nsecond']);
  });

  it('supports readline deletion controls and Unicode characters', () => {
    const capture = new TerminalPromptCapture();
    capture.consume('修复 abc');
    capture.consume('\u0017');
    capture.consume('输入框');

    expect(capture.draft).toBe('修复 输入框');
    capture.consume('\u0003');
    expect(capture.draft).toBe('');
  });

  it('restores an unsent draft', () => {
    const capture = new TerminalPromptCapture();
    capture.restore('继续完成 V0.5');
    capture.consume('，并测试');
    expect(capture.draft).toBe('继续完成 V0.5，并测试');
  });
});

describe('prompt asset safety and search', () => {
  it('redacts common tokens and labeled secrets before persistence', () => {
    const result = redactSensitiveContent(
      'Authorization: Bearer abcdefghijklmnop api_key=sk-abcdefghijklmnop password="hunter22"',
    );

    expect(result.content).not.toContain('abcdefghijklmnop');
    expect(result.content).not.toContain('hunter22');
    expect(result.redactions).toBeGreaterThanOrEqual(2);
  });

  it('searches content, terminal name, and agent type case-insensitively', () => {
    const asset: PromptAsset = {
      id: '1',
      workspaceId: 'w1',
      terminalId: 't1',
      terminalName: 'Claude Review',
      agentType: 'claude',
      kind: 'history',
      content: 'Fix the composition cursor',
      redacted: false,
      favorite: false,
      pinned: false,
      createdAt: 1,
      updatedAt: 1,
    };

    expect(promptAssetMatches(asset, 'CURSOR')).toBe(true);
    expect(promptAssetMatches(asset, 'review')).toBe(true);
    expect(promptAssetMatches(asset, 'codex')).toBe(false);
  });
});
