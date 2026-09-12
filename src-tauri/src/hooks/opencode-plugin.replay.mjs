/**
 * Replays a real OpenCode session's events against the plugin and checks what it reports.
 *
 * The plugin turns OpenCode's own events into the states Termexo draws, and the distinction that
 * matters is invisible at the moment it happens: OpenCode goes idle at the end of every step of
 * its loop, and the next step begins in the same instant. Reading the first of those as a
 * finished task announced completion several times per turn, and announced it again while the
 * agent sat waiting for the person to answer a question.
 *
 * Run by the Rust test of the same name. Exits non-zero with an explanation when a reading is
 * wrong; the one argument is the plugin source to exercise.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SESSION = 'ses_replay';
/** The settle time the replay runs the plugin at, in place of the two seconds it ships with. */
const SETTLE_MS = 50;
/** Every check has to outlast that settle time for the plugin to have made up its mind. */
const PAST_SETTLE_MS = SETTLE_MS * 4;

const failures = [];

function check(condition, description) {
  if (!condition) failures.push(description);
}

const shipped = readFileSync(process.argv[2], 'utf8');
// The wait is shortened rather than waited out: three settle times would be most of the suite.
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
const status = (type) => emit('session.status', { sessionID: SESSION, status: { type } });
const tool = (id, name, state) =>
  emit('message.part.updated', {
    part: {
      sessionID: SESSION,
      id,
      type: 'tool',
      tool: name,
      callID: `call_${id}`,
      state: { status: state },
    },
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, PAST_SETTLE_MS));
const recorded = () => {
  const contents = readFileSync(eventFile, 'utf8').trim();
  return contents ? contents.split('\n').map((line) => JSON.parse(line).payload.event_type) : [];
};
const completions = () => recorded().filter((type) => type === 'task.completed').length;

await emit('session.created', { sessionID: SESSION, info: { id: SESSION } });
await hooks['chat.message']({ sessionID: SESSION });

// Two steps of one turn, each ending in an idle the next step immediately follows.
await status('idle');
await status('busy');
await status('idle');
await status('busy');
await settle();
check(completions() === 0, `a step boundary was reported as a finished task (${recorded()})`);

// The agent stops to ask, and the tool that asks keeps running until the answer comes.
await emit('question.asked', { sessionID: SESSION, requestID: 'q1' });
await tool('t1', 'question', 'running');
await status('idle');
await settle();
check(
  recorded().at(-1) === 'user.input.required',
  `waiting for a person did not stay on screen (${recorded().slice(-3)})`,
);
check(completions() === 0, 'waiting for a person was reported as a finished task');

// Answered, worked, and only then actually finished.
await emit('question.replied', { sessionID: SESSION, requestID: 'q1' });
await tool('t1', 'question', 'completed');
await status('busy');
await status('idle');
await settle();
check(recorded().at(-1) === 'task.completed', `the finished turn was not reported (${recorded()})`);
check(completions() === 1, `the turn was reported finished ${completions()} times`);

// A subagent runs as a session of its own and opens by sending a message. The turn belongs to
// the session that started it, and has to still be able to end.
await emit('session.created', {
  sessionID: 'ses_child',
  info: { id: 'ses_child', parentID: SESSION },
});
await hooks['chat.message']({ sessionID: 'ses_child' });
await emit('session.status', { sessionID: 'ses_child', status: { type: 'busy' } });
check(
  recorded().filter((type) => type === 'session.started').length === 1,
  'a subagent was reported as a session of its own',
);

await status('busy');
await status('idle');
await settle();
check(completions() === 2, `the turn did not end after a subagent ran (${recorded().slice(-4)})`);

await hooks.dispose();

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ok');
