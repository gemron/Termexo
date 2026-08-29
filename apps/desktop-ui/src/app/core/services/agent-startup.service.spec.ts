import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_STARTUP_QUIET_MS,
  AGENT_STARTUP_SETTLE_FLOOR_MS,
  AGENT_STARTUP_TIMEOUT_MS,
} from '../models/agent-startup';
import { AgentStartupService } from './agent-startup.service';

const ESCAPE = String.fromCharCode(27);
/** Mirrors the labels of Claude Code's current folder-trust screen. */
const CLAUDE_TRUST_DIALOG = [
  'D:\\devlop\\Termexo',
  'Quick safety check: Is this a project you created or one you trust?',
  `${ESCAPE}[1mClaude Code'll be able to read, edit, and execute files here.${ESCAPE}[0m`,
  '❯ 1. Yes, I trust this folder',
  '  2. No, exit',
].join('\n');
/** A numbered picker with no wording we know, such as Codex CLI's first-run workspace gate. */
const UNKNOWN_PICKER = ['› 1. Use the default setting', '  2. Change it'].join('\n');
const READY_PROMPT = `${ESCAPE}[2m╭────────────╮\n│ > │\n╰────────────╯\n  ? for shortcuts${ESCAPE}[0m`;

function trace() {
  const calls: string[] = [];
  return {
    calls,
    confirm: vi.fn(async () => void calls.push('confirm')),
    submit: vi.fn(async () => void calls.push('submit')),
    onFailed: vi.fn(),
  };
}

describe('AgentStartupService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers the folder trust dialog before handing over the prompt', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');

    service.ingest('terminal-1', CLAUDE_TRUST_DIALOG);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['confirm']);

    service.ingest('terminal-1', READY_PROMPT);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['confirm', 'submit']);
    expect(service.awaitingTerminalIds()).toEqual([]);
  });

  it('answers a numbered startup picker whose wording it does not recognise', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');

    service.ingest('terminal-1', UNKNOWN_PICKER);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['confirm']);

    service.ingest('terminal-1', READY_PROMPT);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['confirm', 'submit']);
  });

  it('keeps waiting while the agent is still painting its banner', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');

    for (let frame = 0; frame < 4; frame += 1) {
      service.ingest('terminal-1', 'Loading tools...');
      await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS - 100);
    }
    expect(handlers.calls).toEqual([]);

    service.ingest('terminal-1', READY_PROMPT);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['submit']);
  });

  it('does not mistake a boot pause for an agent waiting on input', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');

    // The shell echoes the launch command, then Node boots in silence for several seconds.
    service.ingest('terminal-1', 'PS D:\\devlop\\Termexo> claude');
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_SETTLE_FLOOR_MS - AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['submit']);
  });

  it('waits for the PTY before spending any of the startup budget', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);

    // The terminal record exists, but the PTY is still being spawned.
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_TIMEOUT_MS * 2);
    expect(handlers.calls).toEqual([]);
    expect(service.awaitingTerminalIds()).toEqual(['terminal-1']);

    service.markRuntimeStarted('terminal-1');
    service.ingest('terminal-1', READY_PROMPT);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['submit']);
  });

  it('checks output that arrived while the PTY was still starting', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);

    service.ingest('terminal-1', READY_PROMPT);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual([]);

    service.markRuntimeStarted('terminal-1');
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.calls).toEqual(['submit']);
  });

  it('submits once the deadline passes even if the output never settles', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');

    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_TIMEOUT_MS);

    expect(handlers.submit).toHaveBeenCalledTimes(1);
    expect(handlers.confirm).not.toHaveBeenCalled();
  });

  it('keeps the terminal pending until the prompt write has completed', async () => {
    const service = new AgentStartupService();
    let finishSubmit!: () => void;
    const handlers = {
      ...trace(),
      submit: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishSubmit = resolve;
          }),
      ),
    };
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');

    service.ingest('terminal-1', READY_PROMPT);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);
    expect(handlers.submit).toHaveBeenCalledOnce();
    expect(service.awaitingTerminalIds()).toEqual(['terminal-1']);

    finishSubmit();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.awaitingTerminalIds()).toEqual([]);
  });

  it('reports the reason when the terminal disappears before the prompt lands', async () => {
    const service = new AgentStartupService();
    const handlers = {
      ...trace(),
      submit: vi.fn(() => Promise.reject(new Error('任务终端在发送指令前已关闭。'))),
    };
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');

    service.ingest('terminal-1', READY_PROMPT);
    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_QUIET_MS);

    expect(handlers.onFailed).toHaveBeenCalledWith('任务终端在发送指令前已关闭。');
  });

  it('stops driving a terminal that was cancelled', async () => {
    const service = new AgentStartupService();
    const handlers = trace();
    service.arm('terminal-1', handlers);
    service.markRuntimeStarted('terminal-1');
    service.ingest('terminal-1', READY_PROMPT);
    service.cancel('terminal-1');

    await vi.advanceTimersByTimeAsync(AGENT_STARTUP_TIMEOUT_MS);

    expect(handlers.calls).toEqual([]);
    expect(service.awaitingTerminalIds()).toEqual([]);
  });
});
