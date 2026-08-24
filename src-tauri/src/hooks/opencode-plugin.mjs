import { appendFile } from 'node:fs/promises';

const eventFile = __EVENT_FILE__;
const terminalID = __TERMINAL_ID__;
let activeSessionID = __SESSION_ID__ ?? undefined;
let announcedSessionID;
let sequence = 0;
const toolStates = new Map();
const sessionStates = new Map();

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

async function activate(sessionID, sourceEventType, force = false) {
  if (!sessionID) return false;
  if (!activeSessionID || force) {
    if (activeSessionID !== sessionID) {
      activeSessionID = sessionID;
      toolStates.clear();
      sessionStates.clear();
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
      if (await activate(input.sessionID, 'chat.message', true)) {
        await writeEvent('agent.thinking', input.sessionID, 'chat.message');
      }
    },
    event: async ({ event }) => {
      const properties = event?.properties ?? {};
      const source = event?.type ?? 'unknown';
      const sessionID = eventSessionID(event);

      if (source === 'session.created') {
        if (properties.info?.parentID) return;
        await activate(sessionID, source, true);
        return;
      }
      if (!(await activate(sessionID, source))) return;

      if (source === 'session.deleted') {
        await writeEvent('session.ended', sessionID, source);
        return;
      }
      if (source === 'session.idle') {
        if (sessionStates.get(sessionID) !== 'idle') {
          sessionStates.set(sessionID, 'idle');
          await writeEvent('task.completed', sessionID, source);
        }
        return;
      }
      if (source === 'session.status') {
        const status = properties.status?.type;
        if (!status || sessionStates.get(sessionID) === status) return;
        sessionStates.set(sessionID, status);
        if (status === 'idle') await writeEvent('task.completed', sessionID, source);
        if (status === 'busy') await writeEvent('agent.thinking', sessionID, source);
        if (status === 'retry') {
          const message = properties.status?.message;
          await writeEvent(retryEventType(message), sessionID, source, {
            message,
          });
        }
        return;
      }
      if (source === 'session.error') {
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
        await writeEvent('approval.required', sessionID, source, {
          request_id: properties.requestID ?? properties.id,
          title: properties.permission ?? properties.title ?? properties.type,
        });
        return;
      }
      if (source === 'question.asked') {
        await writeEvent('user.input.required', sessionID, source, {
          request_id: properties.requestID ?? properties.id,
        });
        return;
      }
      if (['permission.replied', 'question.replied', 'question.rejected'].includes(source)) {
        await writeEvent('agent.thinking', sessionID, source);
        return;
      }
      if (source === 'message.updated') {
        if (properties.info?.role === 'user') {
          await writeEvent('agent.thinking', sessionID, source);
        }
        return;
      }
      if (source !== 'message.part.updated') return;

      const part = properties.part;
      if (part?.type === 'retry') {
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
      if (activeSessionID) await writeEvent('session.ended', activeSessionID, 'plugin.dispose');
    },
  };
};
