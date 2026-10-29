import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOpenCodeReport } from '../src/opencode-evidence.js';

const fixture = () => ({ info: { id: 'ses_worker', model: { providerID: 'opencode', id: 'test' }, outcome: 'succeeded' }, messages: [
  { type: 'user', text: 'Implement approved task' },
  { type: 'assistant', model: { providerID: 'opencode', id: 'test' }, time: { completed: 2 }, finish: 'stop', content: [{ type: 'text', text: '{"summary":"done"}' }] },
  { type: 'idle', outcome: 'succeeded' },
] });
test('OpenCode requires native successful completion and binds the approved session/model', () => {
  const data = fixture();
  assert.deepEqual(readOpenCodeReport(data, 'ses_worker', 'opencode/test').report, { summary: 'done' });
  assert.throws(() => readOpenCodeReport(data, 'ses_other'), /another session/);
  assert.throws(() => readOpenCodeReport(data, 'ses_worker', 'other/model'), /model changed/);
  data.messages.pop();
  assert.equal(readOpenCodeReport(data, 'ses_worker').completed, false);
});
test('interrupted, failed, truncated and natural-language replies never become successful delivery', () => {
  for (const outcome of ['failed', 'interrupted']) {
    const data = fixture(); data.info.outcome = outcome;
    assert.equal(readOpenCodeReport(data, 'ses_worker').completed, false);
    assert.equal(readOpenCodeReport(data, 'ses_worker').interrupted, outcome === 'interrupted');
  }
  const truncated = fixture(); (truncated.messages[1] as any).finish = 'length';
  assert.equal(readOpenCodeReport(truncated, 'ses_worker').completed, false);
  const prose = fixture(); (prose.messages[1] as any).content[0].text = 'All tests passed!';
  assert.equal(readOpenCodeReport(prose, 'ses_worker').report, undefined);
});
test('provider quota failures retain their actual cause instead of claiming a user interruption', () => {
  const data = fixture(); data.info.outcome = 'failed';
  (data.messages[1] as any).error = { type: 'provider.free-limit', message: 'Free usage limit reached', status: 429 };
  const result = readOpenCodeReport(data, 'ses_worker');
  assert.equal(result.interrupted, false); assert.equal(result.completed, false);
  assert.equal(result.failure, 'Free usage limit reached');
});
test('manual takeover invalidates even a previously completed OpenCode report', () => {
  const data = fixture(); data.messages.push({ type: 'user', text: 'Change something else' });
  const result = readOpenCodeReport(data, 'ses_worker');
  assert.equal(result.takenOver, true); assert.equal(result.completed, false);
});
