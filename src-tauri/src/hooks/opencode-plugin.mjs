import { appendFile } from 'node:fs/promises';

const eventFile = __EVENT_FILE__;
const terminalID = __TERMINAL_ID__;
let activeSessionID = __SESSION_ID__ ?? undefined;
let announcedSessionID;
let sequence = 0;
const toolStates = new Map();
const sessionStates = new Map();
/** Sessions stopped on a question or a permission, where the agent is waiting on a person. */
const awaitingReply = new Set();
/**
 * How each session's current turn ended, for the turns that did not simply run to completion.
 *
 * OpenCode goes idle after a failure, an interrupt or a declined request exactly as it does after
 * finished work. Reading that idle alone announced every one of those turns as completed two
 * seconds after it had stopped.
 */
const turnEndings = new Map();
/**
 * Sessions the agent spawned for itself.
 *
 * OpenCode's `task` tool runs subagents as sessions of their own, and each one opens by sending a
 * message. Letting that take the turn over left the real session's own completion attributed to a
 * subagent that had already finished, so the terminal never showed the turn ending at all.
 */
const childSessions = new Set();
/** The pending "has it really stopped?" check for each session. */
const idleTimers = new Map();

/**
 * How long a session has to stay quiet before it counts as finished.
 *
 * OpenCode reports idle at the end of every step of its own loop, and the next step begins in the
 * same second. Announcing completion on the first of those told the user the task was done while
 * the agent was still working, several times per turn.
 */
const IDLE_SETTLE_MS = 2000;

const TurnEnding = Object.freeze({
  /** A failure or an interrupt, written when it happened: the idle after it has nothing to add. */
  REPORTED: 'reported',
  /** The person turned down a permission or a question; if the agent stops there, it was halted. */
  DECLINED: 'declined',
});

/** The error OpenCode ends a turn with when the user interrupts it. */
const ABORTED_ERROR_NAME = 'MessageAbortedError';
/** The permission reply that turns the request down. */
const REJECTED_PERMISSION_REPLY = 'reject';

function eventSessionID(event) {
  const properties = event?.properties ?? {};
  return (
    properties.sessionID ??
    properties.info?.sessionID ??
    properties.info?.id ??
    properties.part?.sessionID
  );
}

function errorMessage(error) {
  if (!error) return 'OpenCode error';
  if (typeof error === 'string') return error;
  return error.data?.message ?? error.message ?? error.name ?? error.data?.name ?? 'OpenCode error';
}

function retryEventType(message) {
  const value = String(message ?? '').toLowerCase();
  if (value.includes('rate limit') || value.includes('rate_limit') || value.includes('429')) {
    return 'agent.rate_limited';
  }
  if (value.includes('timeout') || value.includes('timed out')) return 'agent.timeout';
  return 'agent.thinking';
}

async function writeEvent(eventType, sessionID, sourceEventType, detail = {}) {
  const now = Date.now();
  const record = {
    eventKey: `${terminalID}-${now}-${sequence++}`,
    agentType: 'opencode',
    terminalId: terminalID,
    receivedAt: now,
    payload: {
      event_type: eventType,
      native_session_id: sessionID,
      detail: { source: sourceEventType, ...detail },
    },
  };
  await appendFile(eventFile, `${JSON.stringify(record)}\n`, 'utf8').catch(() => undefined);
}

/** Called whenever the agent shows a sign of life, which withdraws a pending completion. */
function cancelIdle(sessionID) {
  const timer = idleTimers.get(sessionID);
  if (timer === undefined) return;
  clearTimeout(timer);
  idleTimers.delete(sessionID);
}

/**
 * Announces completion only if the session is still quiet once the settle time has passed.
 *
 * A step boundary and the end of a turn look identical at the moment they happen; what separates
 * them is whether anything follows.
 */
function scheduleIdle(sessionID, sourceEventType) {
  cancelIdle(sessionID);
  const timer = setTimeout(() => {
    idleTimers.delete(sessionID);
    // Waiting on a person is not finishing, however long the wait lasts.
    if (awaitingReply.has(sessionID)) return;
    const ending = turnEndings.get(sessionID);
    if (ending === TurnEnding.REPORTED) return;
    const eventType = ending === TurnEnding.DECLINED ? 'agent.interrupted' : 'task.completed';
    void writeEvent(eventType, sessionID, sourceEventType);
  }, IDLE_SETTLE_MS);
  // The plugin must not keep the CLI alive just to answer a question nobody is waiting for.
  timer.unref?.();
  idleTimers.set(sessionID, timer);
}

/** The agent carries on working, so however its turn seemed to have ended no longer holds. */
function continueTurn(sessionID) {
  turnEndings.delete(sessionID);
  cancelIdle(sessionID);
}

/** The agent is working again: any pending completion is wrong, and it is no longer waiting. */
function resume(sessionID) {
  awaitingReply.delete(sessionID);
  continueTurn(sessionID);
}

/** The turn is over and its ending already written; nothing arriving later may replace it. */
function endTurn(sessionID) {
  awaitingReply.delete(sessionID);
  turnEndings.set(sessionID, TurnEnding.REPORTED);
  cancelIdle(sessionID);
}

/**
 * Whether a report about the session's tools arrived after its turn was over.
 *
 * An interrupt marks the running tool as failed only once the session has gone idle. Taking that
 * for new work withdrew the pending outcome and left the terminal showing the tool as running.
 */
function turnIsOver(sessionID) {
  return (
    sessionStates.get(sessionID) === 'idle' || turnEndings.get(sessionID) === TurnEnding.REPORTED
  );
}

function isDeclined(source, properties) {
  if (source === 'question.rejected') return true;
  // `response` is the field's name in OpenCode releases older than the `permission.asked` event.
  const reply = properties.reply ?? properties.response;
  return source === 'permission.replied' && reply === REJECTED_PERMISSION_REPLY;
}

/**
 * The person turned down what the agent asked for.
 *
 * OpenCode stops the turn right there unless it is configured to carry on, so the verdict waits for
 * the idle: stopping is an interrupt, and a further step withdraws it.
 */
async function decline(sessionID, sourceEventType) {
  awaitingReply.delete(sessionID);
  // An interrupt withdraws the request it cut short, and has already said how the turn ended.
  if (turnEndings.get(sessionID) === TurnEnding.REPORTED) return;
  cancelIdle(sessionID);
  turnEndings.set(sessionID, TurnEnding.DECLINED);
  await writeEvent('agent.thinking', sessionID, sourceEventType);
}

async function activate(sessionID, sourceEventType, force = false) {
  if (!sessionID) return false;
  if (!activeSessionID || force) {
    if (activeSessionID !== sessionID) {
      activeSessionID = sessionID;
      toolStates.clear();
      sessionStates.clear();
      awaitingReply.clear();
      turnEndings.clear();
    }
  }
  if (activeSessionID !== sessionID) return false;
  if (announcedSessionID !== sessionID) {
    announcedSessionID = sessionID;
    await writeEvent('session.started', sessionID, sourceEventType);
  }
  return true;
}

export const TermexoPlugin = async () => {
  if (activeSessionID) await activate(activeSessionID, 'plugin.loaded');

  return {
    'chat.message': async (input) => {
      // A subagent opening with a message must not take the turn away from the session that
      // started it; only a session the user themselves switched to may do that.
      if (childSessions.has(input.sessionID)) return;
      if (await activate(input.sessionID, 'chat.message', true)) {
        resume(input.sessionID);
        await writeEvent('agent.thinking', input.sessionID, 'chat.message');
      }
    },
    event: async ({ event }) => {
      const properties = event?.properties ?? {};
      const source = event?.type ?? 'unknown';
      const sessionID = eventSessionID(event);

      if (source === 'session.created') {
        if (properties.info?.parentID) {
          childSessions.add(sessionID);
          return;
        }
        await activate(sessionID, source, true);
        return;
      }
      if (!(await activate(sessionID, source))) return;

      if (source === 'session.deleted') {
        cancelIdle(sessionID);
        await writeEvent('session.ended', sessionID, source);
        return;
      }
      if (source === 'session.idle') {
        if (sessionStates.get(sessionID) !== 'idle') {
          sessionStates.set(sessionID, 'idle');
          scheduleIdle(sessionID, source);
        }
        return;
      }
      if (source === 'session.status') {
        const status = properties.status?.type;
        if (!status || sessionStates.get(sessionID) === status) return;
        sessionStates.set(sessionID, status);
        if (status === 'idle') scheduleIdle(sessionID, source);
        if (status === 'busy') {
          continueTurn(sessionID);
          await writeEvent('agent.thinking', sessionID, source);
        }
        if (status === 'retry') {
          cancelIdle(sessionID);
          const message = properties.status?.message;
          await writeEvent(retryEventType(message), sessionID, source, {
            message,
          });
        }
        return;
      }
      if (source === 'session.error') {
        endTurn(sessionID);
        // Stopping the agent is the user's own decision, neither a failure nor finished work.
        if (properties.error?.name === ABORTED_ERROR_NAME) {
          await writeEvent('agent.interrupted', sessionID, source);
          return;
        }
        const message = errorMessage(properties.error);
        const eventType = retryEventType(message);
        await writeEvent(
          eventType === 'agent.thinking' ? 'agent.failed' : eventType,
          sessionID,
          source,
          { message },
        );
        return;
      }
      if (source === 'permission.asked' || source === 'permission.updated') {
        awaitingReply.add(sessionID);
        cancelIdle(sessionID);
        await writeEvent('approval.required', sessionID, source, {
          request_id: properties.requestID ?? properties.id,
          title: properties.permission ?? properties.title ?? properties.type,
        });
        return;
      }
      if (source === 'question.asked') {
        awaitingReply.add(sessionID);
        cancelIdle(sessionID);
        await writeEvent('user.input.required', sessionID, source, {
          request_id: properties.requestID ?? properties.id,
        });
        return;
      }
      if (isDeclined(source, properties)) {
        await decline(sessionID, source);
        return;
      }
      if (source === 'permission.replied' || source === 'question.replied') {
        resume(sessionID);
        await writeEvent('agent.thinking', sessionID, source);
        return;
      }
      // `message.updated` is deliberately not a sign of work: OpenCode re-publishes the user's
      // message after every step, the last one right after the final idle, which withdrew every
      // completion. A new prompt always arrives through `chat.message` instead.
      if (source !== 'message.part.updated') return;

      const part = properties.part;
      if (part?.type === 'step-start') {
        continueTurn(sessionID);
        return;
      }
      if (part?.type === 'retry') {
        cancelIdle(sessionID);
        const message = errorMessage(part.error);
        await writeEvent(retryEventType(message), sessionID, source, {
          message,
        });
        return;
      }
      if (part?.type !== 'tool') return;
      const status = part.state?.status;
      if (!status || toolStates.get(part.id) === status) return;
      toolStates.set(part.id, status);
      // The tool that asks the question runs for as long as the person takes to answer it.
      // Reporting it as work would replace "waiting for you" with "running" on screen, and the
      // same goes for a tool settling after its turn already ended.
      if (awaitingReply.has(sessionID) || turnIsOver(sessionID)) return;
      cancelIdle(sessionID);
      const detail = { tool_name: part.tool, call_id: part.callID };
      if (status === 'running') await writeEvent('tool.started', sessionID, source, detail);
      if (status === 'completed') await writeEvent('tool.completed', sessionID, source, detail);
      if (status === 'error') {
        await writeEvent('tool.failed', sessionID, source, {
          ...detail,
          message: errorMessage(part.state?.error),
        });
      }
    },
    dispose: async () => {
      for (const timer of idleTimers.values()) clearTimeout(timer);
      idleTimers.clear();
      if (activeSessionID) await writeEvent('session.ended', activeSessionID, 'plugin.dispose');
    },
  };
};
