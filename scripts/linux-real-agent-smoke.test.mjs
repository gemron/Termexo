import assert from 'node:assert/strict';
import test from 'node:test';
import { completedCodexReply } from './linux-real-agent-smoke.mjs';

const record = (value) => `${JSON.stringify(value)}\n`;

test('a marker in tool output cannot substitute for the final assistant reply', () => {
  const transcript =
    record({
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'EXPECTED' },
    }) +
    record({
      type: 'event_msg',
      payload: { type: 'task_complete', last_agent_message: 'wrong reply' },
    });
  assert.equal(completedCodexReply(transcript), 'wrong reply');
  assert.notEqual(completedCodexReply(transcript), 'EXPECTED');
});

test('waits for a complete task record rather than accepting partial output', () => {
  const complete = record({
    type: 'event_msg',
    payload: { type: 'task_complete', last_agent_message: 'EXPECTED' },
  });
  assert.equal(completedCodexReply(complete.slice(0, -1)), null);
  assert.equal(completedCodexReply(complete), 'EXPECTED');
});
