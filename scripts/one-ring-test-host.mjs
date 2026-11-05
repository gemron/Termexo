// Deterministic MCP Host for native integration tests. Real model tasks are explicitly opt-in.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [reportPath, project, source, mode, ...args] = process.argv.slice(2);
const report = (data) => writeFile(reportPath, JSON.stringify(data), { mode: 0o600 });
const configs = args.flatMap((value, index) => (args[index - 1] === '-c' ? [value] : []));
let client;
try {
  if (mode === 'disabled') {
    assert(configs.includes('mcp_servers.one_ring.enabled=false'));
    assert(configs.includes('plugins."one-ring@one-ring-local".enabled=false'));
    await report({ phase: 'disabled', passed: true });
  } else {
    const entry = configs.find((value) => value.startsWith('mcp_servers.one_ring='));
    assert(entry, 'Codex plugin transport must be injected at the actual PTY launch');
    const transport = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import sys,tomllib,json; print(json.dumps(tomllib.loads(sys.argv[1])["mcp_servers"]["one_ring"]))',
          entry,
        ],
        { encoding: 'utf8' },
      ),
    );
    const { Client } = await import(
      pathToFileURL(join(source, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))
    );
    const { StdioClientTransport } = await import(
      pathToFileURL(join(source, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'))
    );
    client = new Client({ name: 'termexo-native-test-host', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: transport.command,
        args: transport.args,
        env: { ...process.env, ...transport.env },
      }),
    );
    const call = async (name, arguments_ = {}) => {
      const result = await client.callTool({ name, arguments: arguments_ });
      assert(!result.isError, JSON.stringify(result.content));
      return result.structuredContent.result;
    };
    const wait = async (id, predicate, milliseconds = 180000) => {
      const end = Date.now() + milliseconds;
      while (Date.now() < end) {
        const record = await call('one_ring_worker_status', { workerId: id });
        assert(!['FAILED', 'UNKNOWN'].includes(record.status), record.error);
        if (predicate(record)) return record;
        await delay(200);
      }
      throw new Error('Worker did not reach the requested state before timeout');
    };
    const doctor = await call('one_ring_doctor');
    assert.equal(doctor.terminal.launcher, 'termexo');
    const first = await call('one_ring_open_worker', {
      cwd: project,
      label: '自动测试 · 连续任务',
      access: 'read-only',
    });
    let worker = await wait(first.id, (value) => value.status === 'IDLE');
    if (mode === 'real') {
      await call('one_ring_send_task', {
        workerId: first.id,
        prompt:
          '只读测试：请通过命令读取当前目录 fixture.txt，记住完整内容，最终只回复文件内容。不要修改文件，不要访问其他目录，不要派发其他 Worker。',
      });
      worker = await wait(first.id, (value) => value.status === 'IDLE' && value.tasks.length === 1);
      assert.equal(worker.tasks[0].status, 'COMPLETED', worker.tasks[0].error);
      await call('one_ring_send_task', {
        workerId: first.id,
        prompt:
          '刚才读取的 fixture.txt 的完整内容是什么？只凭当前会话记忆回复原内容，不执行任何命令，不修改文件。',
      });
      worker = await wait(first.id, (value) => value.status === 'IDLE' && value.tasks.length === 2);
      const marker = (await readFile(join(project, 'fixture.txt'), 'utf8')).trim();
      assert(
        worker.tasks.every(
          (task) => task.status === 'COMPLETED' && String(task.report).includes(marker),
        ),
      );
      assert(
        worker.tasks[0].commands.some(
          (command) => command.exitCode === 0 && command.output.includes(marker),
        ),
      );
      assert.equal(worker.tasks[1].commands.length, 0);
      assert.equal(worker.sessionId, worker.terminal.sessionId);
    }
    await report({ phase: 'close_worker', first: worker, realTasks: mode === 'real' });
    await wait(first.id, (value) => value.status === 'CLOSED', 60000);
    const second = await call('one_ring_open_worker', {
      cwd: project,
      label: '自动测试 · Host 断开清理',
      access: 'read-only',
    });
    const next = await wait(second.id, (value) => value.status === 'IDLE');
    await report({ phase: 'close_host', first: worker, second: next, realTasks: mode === 'real' });
    // The test closes this Host PTY. Its stdin pipe then closes the MCP and stops the Worker.
    await new Promise(() => {});
  }
} catch (error) {
  await report({ error: String(error) });
  process.exitCode = 1;
} finally {
  await client?.close();
}
