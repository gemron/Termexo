import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/mcp.js';
import { Engine } from '../src/core.js';
import { Store } from '../src/store.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('MCP exposes user decisions as host elicitation, never an approve boolean tool', async () => {
  const store = new Store(mkdtempSync(path.join(os.tmpdir(), 'one-ring-mcp-'))), engine = new Engine(store), server = createMcpServer(engine);
  const client = new Client({ name: 'one-ring-contract-test', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'decline' }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  assert(tools.some(tool => tool.name === 'one_ring_request_decision'));
  assert(!tools.some(tool => /approve/.test(tool.name)));
  const decision = tools.find(tool => tool.name === 'one_ring_request_decision')!;
  assert(!JSON.stringify(decision.inputSchema).includes('confirmed'));
  const result = await client.callTool({ name: 'one_ring_list', arguments: {} });
  assert.equal(result.isError, undefined);
  await client.close(); await server.close(); store.close();
});
