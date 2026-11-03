import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AccountLoginFeedbackService } from './account-login-feedback.service';
import { AccountProfile } from '../models/agent.models';

describe('account login feedback', () => {
  let service: AccountLoginFeedbackService;
  const profile: AccountProfile = { id: 'account-a', name: 'Account A', agentType: 'claude',
    authenticated: false, isDefault: false, isSystem: false, diagnostic: '' };
  beforeEach(() => { service = TestBed.inject(AccountLoginFeedbackService); service.begin('terminal-a', profile); });
  afterEach(() => vi.useRealTimers());

  it('reports a split, styled invalid-code response only on the matching account', () => {
    service.begin('terminal-b', { ...profile, id: 'account-b' });
    service.verifying('terminal-a');
    service.observeOutput('terminal-a', '\x1b[31mError: Invalid author');
    service.observeOutput('terminal-a', 'ization code\x1b[0m');
    expect(service.get('terminal-a')?.phase).toBe('rejected');
    expect(service.get('terminal-b')?.phase).toBe('waiting');
    expect(service.confirm('terminal-a', true, true)).toBe(false);
  });

  it('shows a timeout after sending, accepts a later confirmed result, and cancels timers on close', () => {
    vi.useFakeTimers();
    service.verifying('terminal-a');
    vi.advanceTimersByTime(30_000);
    expect(service.get('terminal-a')?.phase).toBe('timeout');
    expect(service.confirm('terminal-a', true)).toBe(true);
    service.forget('terminal-a');
    vi.runAllTimers();
    expect(service.get('terminal-a')).toBeUndefined();
  });

  it('does not count existing credentials as a successful new login', () => {
    service.begin('terminal-a', { ...profile, authenticated: true });
    service.verifying('terminal-a');
    expect(service.confirm('terminal-a', true)).toBe(false);
    service.observeOutput('terminal-a', 'Login successful');
    expect(service.confirm('terminal-a', false)).toBe(false);
    expect(service.confirm('terminal-a', true)).toBe(true);
  });

  it('ignores late output and refreshes from a replaced attempt', () => {
    service.setPhase('terminal-a', 'restarting');
    service.observeOutput('terminal-a', 'Login successful');
    expect(service.confirm('terminal-a', true, true)).toBe(false);
    service.forget('terminal-a');
    service.begin('new-attempt', profile);
    service.observeOutput('terminal-a', 'invalid_grant');
    expect(service.get('terminal-a')).toBeUndefined();
    expect(service.get('new-attempt')?.phase).toBe('waiting');
  });
});
