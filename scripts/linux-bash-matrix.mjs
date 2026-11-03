import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const agents = ['claude', 'codex', 'opencode', 'pi', 'grok', 'antigravity'];
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** Recording CLI fixtures exercise the generated command and actual Bash/PTY argv transport. */
export async function prepareBashMatrix(state, repository) {
  const directory = join(state, "CLI tools's ! 空格");
  await mkdir(directory);
  const capture = join(directory, 'capture.mjs');
  await writeFile(
    capture,
    `import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
const [cli, ...args] = process.argv.slice(2);
appendFileSync(join(process.env.TERMEXO_BASH_CAPTURE_DIR, cli + '.jsonl'), JSON.stringify(args) + '\\n');
console.log('[]');\n`,
  );
  const node = join(repository, 'apps/desktop-ui/node_modules/node/bin/node');
  const environment = {
    TERMEXO_BASH_CAPTURE_DIR: directory,
    CODEX_HOME: join(state, 'home/.codex'),
    CLAUDE_CONFIG_DIR: join(state, 'home/.claude'),
    GROK_HOME: join(state, 'home/.grok'),
    PI_CODING_AGENT_DIR: join(state, 'home/.pi/agent'),
    PI_CODING_AGENT_SESSION_DIR: join(state, 'home/.pi/agent/sessions'),
    USERPROFILE: join(state, 'foreign-windows-home'),
  };
  const versions = {
    claude: '3.2.0 (Claude Code)',
    codex: 'codex-cli 0.166.0',
    opencode: 'opencode v2.0.24',
    pi: 'pi 1.0.0',
    grok: 'grok 1.0.0',
    antigravity: '1.2.10',
  };
  for (const cli of agents) {
    const file = join(directory, cli);
    await writeFile(
      file,
      `#!/bin/bash
for argument in "$@"; do
  case "$argument" in
    --version|-v|version) printf '%s\\n' ${quote(versions[cli])}; exit 0 ;;
  esac
done
exec ${quote(node)} ${quote(capture)} ${quote(cli)} "$@"
`,
      { mode: 0o755 },
    );
    environment[`TERMEXO_${cli.toUpperCase()}_PATH`] = file;
  }
  return { directory, environment };
}

export async function runBashMatrix({ invoke, until, fixtures, project, workspace, output }) {
  const probe = "provider/model's name ! $HOME $(touch injected) ; 中文";
  const results = [];
  const records = async (cli) => {
    try {
      return (await readFile(join(fixtures.directory, `${cli}.jsonl`), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };
  const execute = async (id, cli, launch, accountLogin, matches) => {
    try {
      await invoke('create_terminal', {
        request: {
          terminalId: id,
          shell: '/bin/bash',
          workingDirectory: project,
          command: launch.command,
          agentType: cli,
          workspaceId: workspace.id,
          accountLogin,
          cols: 120,
          rows: 30,
          viewerId: 'bash-matrix',
        },
      });
      let observed;
      await until(async () => {
        observed = (await records(cli)).find(matches);
        return Boolean(observed);
      }, `${cli} Bash argv`);
      results.push({
        cli,
        operation: accountLogin ? 'login' : 'launch',
        command: launch.command,
        argv: observed,
      });
    } finally {
      await invoke('close_terminal', { terminalId: id, preserveRepositoryBaseline: false });
    }
  };
  for (const cli of agents) {
    const id = `bash-matrix-${cli}`;
    const launch = await invoke(`prepare_${cli}_launch`, {
      request: {
        terminalId: id,
        workspaceId: workspace.id,
        model: probe,
        workingDirectory: project,
        context1m: false,
        autoConfirm: false,
      },
    });
    await execute(id, cli, launch, false, (args) => {
      const index = args.indexOf('--model');
      return index >= 0 && args[index + 1] === probe;
    });
  }
  for (const cli of ['claude', 'codex']) {
    const id = `bash-matrix-login-${cli}`;
    const launch = await invoke('prepare_account_login', {
      request: {
        terminalId: id,
        workspaceId: workspace.id,
        accountProfileId: `${cli}-system`,
      },
    });
    const expected = cli === 'claude' ? ['auth', 'login'] : ['login'];
    await execute(
      id,
      cli,
      launch,
      true,
      (args) => JSON.stringify(args) === JSON.stringify(expected),
    );
  }
  assert.deepEqual(await readdir(project), [], 'Shell substitutions must not execute');
  await assert.rejects(
    access(fixtures.environment.USERPROFILE),
    { code: 'ENOENT' },
    'Linux must not write agent configuration under an inherited Windows USERPROFILE',
  );
  const report = {
    status: 'passed',
    shell: '/bin/bash',
    mode: 'recording CLI fixtures; no model requests',
    results,
  };
  await writeFile(join(output, 'bash-matrix.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
