/**
 * Replays real OpenCode sessions' events against the plugin and checks what it reports.
 *
 * The plugin turns OpenCode's own events into the states Termexo draws, and the distinction that
 * matters is invisible at the moment it happens: OpenCode goes idle at the end of a turn however
 * the turn ended — finished, failed, interrupted, or turned down by the person — and the events
 * around that idle are the only way to tell those apart. It also re-publishes the user's message
 * right after the final idle, which once withdrew every completion.
 *
 * The sequences follow OpenCode 1.18.30 as recorded on a real terminal, keeping every event the
 * plugin inspects in the order it arrived.
 *
 * Run by the Rust test of the same name. Exits non-zero with an explanation when a reading is
 * wrong; the one argument is the plugin source to exercise.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The settle time the replay runs the plugin at, in place of the two seconds it ships with. */
const SETTLE_MS = 50;
/** Every check has to outlast that settle time for the plugin to have made up its mind. */
const PAST_SETTLE_MS = SETTLE_MS * 4;

const failures = [];

function check(condition, description) {
  if (!condition) failures.push(description);
}

const shipped = readFileSync(process.argv[2], 'utf8');
// The wait is shortened rather than waited out: every scenario settles at least once.
const source = shipped.replace(
  'const IDLE_SETTLE_MS = 2000;',
  `const IDLE_SETTLE_MS = ${SETTLE_MS};`,
);
check(source !== shipped, 'the settle time is no longer where the replay expects it');
const directory = mkdtempSync(join(tmpdir(), 'termexo-opencode-'));
const eventFile = join(directory, 'events.jsonl');
const pluginFile = join(directory, 'plugin.mjs');
writeFileSync(eventFile, '', 'utf8');
writeFileSync(
  pluginFile,
  source
    .replace('__EVENT_FILE__', JSON.stringify(eventFile))
    .replace('__TERMINAL_ID__', JSON.stringify('replay-terminal'))
    .replace('__SESSION_ID__', JSON.stringify(null)),
  'utf8',
);

const { TermexoPlugin } = await import(pathToFileURL(pluginFile).href);
const hooks = await TermexoPlugin({});

const emit = (type, properties) => hooks.event({ event: { type, properties } });
const status = (sessionID, type, details = {}) =>
  emit('session.status', { sessionID, status: { type, ...details } });
const message = (sessionID, role, info = {}) =>
  emit('message.updated', { sessionID, info: { id: `msg_${role}`, sessionID, role, ...info } });
const part = (sessionID, fields) =>
  emit('message.part.updated', {
    sessionID,
    part: { sessionID, messageID: 'msg_assistant', ...fields },
  });
const step = (sessionID, type) => part(sessionID, { id: `prt_${type}`, type });
const tool = (sessionID, id, name, toolStatus, error) =>
  part(sessionID, {
    id,
    type: 'tool',
    tool: name,
    callID: `call_${id}`,
    state: error === undefined ? { status: toolStatus } : { status: toolStatus, error },
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, PAST_SETTLE_MS));
const recorded = () => {
  const contents = readFileSync(eventFile, 'utf8').trim();
  return contents ? contents.split('\n').map((line) => JSON.parse(line).payload.event_type) : [];
};
const recordedSince = (mark) => recorded().slice(mark);
const count = (events, type) => events.filter((event) => event === type).length;

/** A session of its own, so nothing an earlier scenario left behind colours the next one. */
async function openSession(sessionID) {
  await emit('session.created', { sessionID, info: { id: sessionID } });
  return recorded().length;
}

/** A prompt submitted at the terminal, up to the moment the model is asked. */
async function submitPrompt(sessionID) {
  await hooks['chat.message']({ sessionID });
  await message(sessionID, 'user');
  await status(sessionID, 'busy');
  await message(sessionID, 'assistant');
  // The user's message again, now carrying the diff summary.
  await message(sessionID, 'user');
  await status(sessionID, 'busy');
}

/** The end of a step that called tools. */
async function finishToolStep(sessionID) {
  await step(sessionID, 'step-finish');
  await message(sessionID, 'assistant', { finish: 'tool-calls' });
  await message(sessionID, 'assistant', { finish: 'tool-calls' });
}

/** OpenCode handing the tools' results back to the model for another step. */
async function askModelAgain(sessionID) {
  await status(sessionID, 'busy');
  await message(sessionID, 'assistant');
  await message(sessionID, 'user');
  await status(sessionID, 'busy');
}

/** OpenCode going idle, reported twice, and then re-publishing the user's message. */
async function goIdle(sessionID) {
  await status(sessionID, 'idle');
  await emit('session.idle', { sessionID });
  await message(sessionID, 'user');
}

/** A last step that only answers, and the idle that ends the turn with it. */
async function answerAndStop(sessionID) {
  await step(sessionID, 'step-start');
  await step(sessionID, 'step-finish');
  await message(sessionID, 'assistant', { finish: 'stop' });
  await message(sessionID, 'assistant', { finish: 'stop' });
  await status(sessionID, 'busy');
  await goIdle(sessionID);
}

/** A bash call held at the permission prompt until the person answers it with `reply`. */
async function answerPermission(sessionID, reply) {
  await submitPrompt(sessionID);
  await step(sessionID, 'step-start');
  await tool(sessionID, 'prt_echo', 'bash', 'pending');
  await tool(sessionID, 'prt_echo', 'bash', 'running');
  await emit('permission.asked', {
    id: 'per_echo',
    sessionID,
    permission: 'bash',
    patterns: ['echo termexo-lab'],
    metadata: {},
    always: ['echo *'],
    tool: { messageID: 'msg_assistant', callID: 'call_prt_echo' },
  });
  check(recorded().at(-1) === 'approval.required', 'a permission prompt was not reported');
  await emit('permission.replied', { sessionID, requestID: 'per_echo', reply });
}

// Two steps of one turn, each ending in an idle the next step immediately follows.
{
  const session = 'ses_steps';
  await openSession(session);
  await hooks['chat.message']({ sessionID: session });
  await status(session, 'idle');
  await status(session, 'busy');
  await status(session, 'idle');
  await status(session, 'busy');
  await settle();
  check(
    count(recorded(), 'task.completed') === 0,
    'a step boundary was reported as a finished task',
  );

  // The agent stops to ask, and the tool that asks keeps running until the answer comes.
  await emit('question.asked', { id: 'que_q1', sessionID: session, questions: [] });
  await tool(session, 'prt_q1', 'question', 'running');
  await status(session, 'idle');
  await settle();
  check(
    recorded().at(-1) === 'user.input.required',
    `waiting for a person did not stay on screen (${recorded().slice(-3)})`,
  );
  check(count(recorded(), 'task.completed') === 0, 'waiting for a person was reported finished');

  // Answered, worked, and only then actually finished.
  await emit('question.replied', { sessionID: session, requestID: 'que_q1', answers: [['red']] });
  await tool(session, 'prt_q1', 'question', 'completed');
  await status(session, 'busy');
  await status(session, 'idle');
  await settle();
  check(recorded().at(-1) === 'task.completed', `the answered turn did not end (${recorded()})`);
  check(
    count(recorded(), 'task.completed') === 1,
    `the turn was reported finished ${count(recorded(), 'task.completed')} times`,
  );

  // A subagent runs as a session of its own and opens by sending a message. The turn belongs to
  // the session that started it, and has to still be able to end.
  await emit('session.created', {
    sessionID: 'ses_child',
    info: { id: 'ses_child', parentID: session },
  });
  await hooks['chat.message']({ sessionID: 'ses_child' });
  await status('ses_child', 'busy');
  check(
    recorded().filter((type) => type === 'session.started').length === 1,
    'a subagent was reported as a session of its own',
  );
  await status(session, 'busy');
  await status(session, 'idle');
  await settle();
  check(
    count(recorded(), 'task.completed') === 2,
    `the turn did not end after a subagent ran (${recorded().slice(-4)})`,
  );
}

// A turn that runs one tool. The user's message comes back right after the final idle.
{
  const session = 'ses_tool_turn';
  const mark = await openSession(session);
  await submitPrompt(session);
  await step(session, 'step-start');
  await tool(session, 'prt_bash', 'bash', 'pending');
  await tool(session, 'prt_bash', 'bash', 'running');
  await tool(session, 'prt_bash', 'bash', 'completed');
  await finishToolStep(session);
  await askModelAgain(session);
  await answerAndStop(session);
  await settle();
  const events = recordedSince(mark);
  check(
    events.includes('tool.started') && events.includes('tool.completed'),
    `the tool's run was not reported (${events})`,
  );
  check(
    events.at(-1) === 'task.completed' && count(events, 'task.completed') === 1,
    `a finished turn did not end in exactly one completion (${events})`,
  );
}

// The provider refuses the request; OpenCode goes idle twice behind the error.
{
  const session = 'ses_api_error';
  const mark = await openSession(session);
  await submitPrompt(session);
  const error = {
    name: 'APIError',
    data: { message: 'The requested model does not exist', statusCode: 400, isRetryable: false },
  };
  await emit('session.error', { sessionID: session, error });
  await status(session, 'idle');
  await emit('session.idle', { sessionID: session });
  await message(session, 'assistant', { error });
  await status(session, 'idle');
  await emit('session.idle', { sessionID: session });
  await settle();
  const events = recordedSince(mark);
  check(events.at(-1) === 'agent.failed', `a failed turn ended up reported as ${events.at(-1)}`);
}

// The provider rate-limits the request, and OpenCode waits to retry it.
{
  const session = 'ses_rate_limit';
  await openSession(session);
  await submitPrompt(session);
  await status(session, 'retry', {
    attempt: 1,
    message: 'Rate limit exceeded, please retry later',
    next: Date.now() + 2500,
  });
  check(recorded().at(-1) === 'agent.rate_limited', 'a rate-limited retry was not reported');
}

// The user interrupts a running command, then sends the next prompt in the same session.
{
  const session = 'ses_interrupt';
  let mark = await openSession(session);
  await submitPrompt(session);
  await step(session, 'step-start');
  await tool(session, 'prt_ping', 'bash', 'pending');
  await tool(session, 'prt_ping', 'bash', 'running');
  const aborted = { name: 'MessageAbortedError', data: { message: 'Aborted' } };
  await emit('session.error', { sessionID: session, error: aborted });
  await status(session, 'idle');
  await emit('session.idle', { sessionID: session });
  // Only once the session is idle does OpenCode mark the command it cut short as failed.
  await tool(session, 'prt_ping', 'bash', 'error', 'Tool execution aborted');
  await message(session, 'assistant', { error: aborted });
  await status(session, 'idle');
  await emit('session.idle', { sessionID: session });
  await settle();
  let events = recordedSince(mark);
  check(
    events.at(-1) === 'agent.interrupted',
    `an interrupt ended up reported as ${events.at(-1)}`,
  );
  check(
    !events.includes('agent.failed') && !events.includes('task.completed'),
    `an interrupt was reported as a failure or a completion (${events})`,
  );

  mark = recorded().length;
  await submitPrompt(session);
  await answerAndStop(session);
  await settle();
  events = recordedSince(mark);
  check(
    events.at(-1) === 'task.completed' && count(events, 'task.completed') === 1,
    `the turn after an interrupt did not end in one completion (${events})`,
  );
}

// The person turns the command down, and OpenCode stops the turn there.
{
  const session = 'ses_permission_rejected';
  const mark = await openSession(session);
  await answerPermission(session, 'reject');
  await tool(
    session,
    'prt_echo',
    'bash',
    'error',
    'The user rejected permission to use this specific tool call.',
  );
  await finishToolStep(session);
  await goIdle(session);
  await settle();
  const events = recordedSince(mark);
  check(
    events.at(-1) === 'agent.interrupted' && !events.includes('task.completed'),
    `a turned-down permission did not leave the turn interrupted (${events})`,
  );
}

// The same refusal with OpenCode's `experimental.continue_loop_on_deny`: the agent carries on.
{
  const session = 'ses_permission_rejected_continued';
  const mark = await openSession(session);
  await answerPermission(session, 'reject');
  await tool(session, 'prt_echo', 'bash', 'error', 'The user rejected permission.');
  await finishToolStep(session);
  await askModelAgain(session);
  await answerAndStop(session);
  await settle();
  const events = recordedSince(mark);
  check(
    events.at(-1) === 'task.completed' && !events.includes('agent.interrupted'),
    `a turn that carried on past a refusal was not reported finished (${events})`,
  );
}

// The person allows the command once, and the turn runs to its end.
{
  const session = 'ses_permission_allowed';
  const mark = await openSession(session);
  await answerPermission(session, 'once');
  check(recorded().at(-1) === 'agent.thinking', 'an allowed permission did not resume the work');
  await tool(session, 'prt_echo', 'bash', 'completed');
  await finishToolStep(session);
  await askModelAgain(session);
  await answerAndStop(session);
  await settle();
  const events = recordedSince(mark);
  check(
    events.at(-1) === 'task.completed' && count(events, 'task.completed') === 1,
    `an allowed permission's turn did not end in one completion (${events})`,
  );
}

// The person dismisses the agent's question with Esc, and OpenCode stops the turn there.
{
  const session = 'ses_question_dismissed';
  const mark = await openSession(session);
  await submitPrompt(session);
  await step(session, 'step-start');
  await tool(session, 'prt_color', 'question', 'pending');
  await emit('question.asked', {
    id: 'que_color',
    sessionID: session,
    questions: [
      {
        question: 'Which color do you prefer?',
        header: 'Color',
        options: [
          { label: 'red', description: 'Red' },
          { label: 'blue', description: 'Blue' },
        ],
      },
    ],
    tool: { messageID: 'msg_assistant', callID: 'call_prt_color' },
  });
  await tool(session, 'prt_color', 'question', 'running');
  check(recorded().at(-1) === 'user.input.required', 'the question was not reported');
  await emit('question.rejected', { sessionID: session, requestID: 'que_color' });
  await tool(session, 'prt_color', 'question', 'error', 'The user dismissed this question');
  await finishToolStep(session);
  await goIdle(session);
  await settle();
  const events = recordedSince(mark);
  check(
    events.at(-1) === 'agent.interrupted' && !events.includes('task.completed'),
    `a dismissed question did not leave the turn interrupted (${events})`,
  );
}

await hooks.dispose();

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ok');
