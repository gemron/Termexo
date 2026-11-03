import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Opt-in only: uses the user's authenticated Codex installation and makes a real model call.
export async function runRealCodexSmoke({ invoke, until, workspace, project, output, screenshot }) {
  const installation = await invoke('detect_codex');
  assert(
    installation.installed && installation.healthy,
    'A working Codex installation is required',
  );
  const terminalId = 'linux-real-codex';
  const marker = `TERMEXO_REAL_AGENT_OK_${randomUUID()}`;
  const fixture = 'agent-fixture.txt';
  await writeFile(join(project, fixture), `${marker}\n`);
  const prompt = `This is a Linux desktop integration test. Run pwd and cat ${fixture} in the current directory, then reply with exactly the file contents. Do not modify files, create files, access any other directory, use network tools, or delegate work.`;
  const launch = await invoke('prepare_codex_launch', {
    request: {
      terminalId,
      workspaceId: workspace.id,
      sessionId: null,
      model: null,
      profileId: '__termexo_cli_native__',
      accountProfileId: 'codex-system',
      autoConfirm: false,
      reasoningEffort: 'low',
    },
  });
  const trust = `projects.${JSON.stringify(project)}.trust_level="trusted"`;
  const command = `${launch.command} --no-daemon --no-alt-screen --sandbox read-only --ask-for-approval never -c ${quote(trust)} -- ${quote(prompt)}`;
  await invoke('save_workspace', {
    workspace: {
      ...workspace,
      name: 'Linux real Codex test',
      terminals: [
        {
          ...workspace.terminals[0],
          id: terminalId,
          name: 'Real Codex',
          agentType: 'codex',
          shell: '/bin/bash',
          status: 'STARTING',
          command,
          accountProfileId: 'codex-system',
          profileId: '__termexo_cli_native__',
        },
      ],
    },
  });
  let screen = '';
  let events = [];
  try {
    await until(
      async () => {
        screen = (await invoke('read_terminal_scrollback', { terminalId })).data;
        await writeFile(join(output, 'real-agent-terminal.txt'), screen);
        await invoke('sync_agent_events');
        events = await invoke('list_agent_events', { terminalId });
        return (
          screen.includes(marker) && events.some((event) => event.eventType === 'task.completed')
        );
      },
      'real Codex model reply and completion hook',
      180000,
    );
    const completion = events.find((event) => event.eventType === 'task.completed');
    assert(completion.nativeSessionId, 'The completion should identify a native Codex session');
    let observedReply;
    await until(
      async () => {
        const transcript = await invoke('get_worker_transcript_path', {
          sessionId: completion.nativeSessionId,
          accountProfileId: 'codex-system',
        });
        if (!transcript) return false;
        observedReply = completedCodexReply(await readFile(transcript, 'utf8'));
        if (observedReply === null) return false;
        assert.equal(observedReply.trim(), marker, 'The final model reply must match the fixture');
        return true;
      },
      'completed Codex transcript',
      10000,
    );
    assert(
      events.some((event) => event.eventType === 'tool.started'),
      'The agent should actually execute a tool',
    );
    assert.equal(await readFile(join(project, fixture), 'utf8'), `${marker}\n`);
    assert.deepEqual(await readdir(project), [fixture], 'The agent should not modify the project');
    await writeFile(join(output, 'real-agent.png'), await screenshot());
    const result = {
      status: 'passed',
      cli: 'codex',
      version: installation.version,
      nativeSessionId: completion.nativeSessionId,
      expectedReply: marker,
      observedReply,
      eventTypes: [...new Set(events.map((event) => event.eventType))],
      checks: [
        'native desktop launch preparation',
        'authenticated model response',
        'Linux command execution',
        'random fixture content returned',
        'completion hook',
        'project unchanged',
      ],
    };
    await writeFile(join(output, 'real-agent.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    if (screen) await writeFile(join(output, 'real-agent-terminal.txt'), screen);
    await writeFile(join(output, 'real-agent-events.json'), `${JSON.stringify(events, null, 2)}\n`);
    await invoke('close_terminal', { terminalId, preserveRepositoryBaseline: false });
  }
}

// Only completed JSONL records count. A tool result containing the marker cannot pass this check.
export function completedCodexReply(transcript) {
  let reply = null;
  for (const line of transcript.split('\n').slice(0, -1)) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.type === 'event_msg' && record.payload?.type === 'task_complete') {
      reply =
        typeof record.payload.last_agent_message === 'string'
          ? record.payload.last_agent_message
          : null;
    }
  }
  return reply;
}

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
