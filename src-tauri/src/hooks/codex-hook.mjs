// Termexo supplies Node and this module when launching a Windows Codex terminal.
// This records status only; it never grants permission or changes tool input.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

try {
  const eventFile = process.env.TERMEXO_CODEX_EVENT_FILE;
  const terminalId = process.env.TERMEXO_CODEX_TERMINAL_ID;
  if (!eventFile || !terminalId) throw new Error('Termexo hook environment is incomplete');
  const input = readFileSync(0, 'utf8');
  let payload;
  try { payload = JSON.parse(input); } catch { payload = { raw: input }; }
  const receivedAt = Date.now();
  const event = { eventKey: `${receivedAt}-${process.pid}`, agentType: 'codex', terminalId, receivedAt, payload };
  mkdirSync(dirname(eventFile), { recursive: true });
  appendFileSync(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
  process.stdout.write('{}\n');
} catch (error) {
  console.error(`Termexo Codex hook: ${error.message}`);
  process.exitCode = 1;
}
