import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentInstallation, type ManagedAgentType } from '../models/agent.models';
import { AgentService } from './agent.service';

const invoke = vi.fn<(command: string) => Promise<AgentInstallation>>();

const installed = (agentType: ManagedAgentType): AgentInstallation => ({
  agentType,
  installed: true,
  healthy: true,
  version: '1.2.3',
  diagnostic: 'Available',
});

describe('AgentService CLI detection', () => {
  let service: AgentService;

  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke }, configurable: true });
    TestBed.configureTestingModule({});
    service = TestBed.inject(AgentService);
  });

  afterEach(() => Reflect.deleteProperty(window, '__TAURI_INTERNALS__'));

  it('keeps each result when another CLI probe fails, then recovers on retry', async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'detect_codex') throw new Error('Codex probe timed out');
      return installed(command.replace('detect_', '') as ManagedAgentType);
    });

    await service.refreshInstallations();

    expect(service.detectionStates().codex).toEqual({
      status: 'error',
      message: 'Codex probe timed out',
    });
    expect(service.codexInstallation()).toBeNull();
    expect(service.installation()?.healthy).toBe(true);
    expect(service.openCodeInstallation()?.healthy).toBe(true);
    expect(service.grokInstallation()?.healthy).toBe(true);
    expect(service.antigravityInstallation()?.healthy).toBe(true);
    expect(service.busy()).toBe(false);

    vi.mocked(invoke).mockResolvedValueOnce(installed('codex'));
    await service.detectCodex();
    expect(service.detectionStates().codex).toEqual({ status: 'complete' });
    expect(service.codexInstallation()?.healthy).toBe(true);
    expect(service.error()).toBeNull();
  });

  it('deduplicates a pending probe and clears stale readiness until it answers', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(installed('codex'));
    await service.detectCodex();
    let resolve!: (value: AgentInstallation) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const pending = service.detectCodex();
    expect(service.detectCodex()).toBe(pending);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(service.detectionStates().codex).toEqual({ status: 'checking' });
    expect(service.codexInstallation()).toBeNull();
    expect(service.busy()).toBe(true);

    resolve({ ...installed('codex'), installed: false, healthy: false });
    await pending;
    expect(service.detectionStates().codex).toEqual({ status: 'complete' });
    expect(service.codexInstallation()?.installed).toBe(false);
    expect(service.busy()).toBe(false);
  });

  it('does not report simulated preview CLIs as installed or invoke a backend', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    await service.refreshInstallations();
    expect(invoke).not.toHaveBeenCalled();
    expect(service.codexInstallation()?.healthy).toBe(false);
    expect(service.detectionStates().codex).toEqual({ status: 'complete' });
  });
});
