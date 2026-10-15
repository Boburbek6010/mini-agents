import { spawn } from 'child_process';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import * as readline from 'readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '../src/agentChat/permissionMcp.ts');
const TSX = path.join(__dirname, '../../node_modules/.bin/tsx');

let server: http.Server;
let url = '';
const seen: { auth?: string; body?: unknown }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as { input: unknown };
      seen.push({ auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ behavior: 'allow', updatedInput: body.input }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

function startMcp(officeUrl: string) {
  const child = spawn(TSX, [SCRIPT], {
    env: { ...process.env, OFFICE_URL: officeUrl, OFFICE_TOKEN: 'tok', OFFICE_AGENT: 'SMM' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const queue: unknown[] = [];
  const waiters: ((v: unknown) => void)[] = [];
  lines.on('line', (l) => {
    const msg = JSON.parse(l) as unknown;
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  const next = () =>
    new Promise<unknown>((r) => (queue.length ? r(queue.shift()) : waiters.push(r)));
  const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n');
  return { child, next, send };
}

describe('office permission MCP script', () => {
  it('handshakes, lists approve, and relays a decision with the bearer token', async () => {
    const { child, next, send } = startMcp(url);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    expect(await next()).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(await next()).toMatchObject({ id: 2, result: { tools: [{ name: 'approve' }] } });
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'approve',
        arguments: { tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 't1' },
      },
    });
    const res = (await next()) as { id: number; result: { content: { text: string }[] } };
    expect(res.id).toBe(3);
    expect(JSON.parse(res.result.content[0].text)).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls' },
    });
    expect(seen.at(-1)).toEqual({
      auth: 'Bearer tok',
      body: { agent: 'SMM', toolName: 'Bash', input: { command: 'ls' } },
    });
    child.kill();
  }, 20_000);

  it('denies when the office is unreachable', async () => {
    const { child, next, send } = startMcp('http://127.0.0.1:1');
    send({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'approve', arguments: { tool_name: 'Bash', input: {}, tool_use_id: 't' } },
    });
    const res = (await next()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(res.result.content[0].text)).toMatchObject({ behavior: 'deny' });
    child.kill();
  }, 20_000);

  it('exits when stdin closes even while an approval request is still open', async () => {
    const hang = http.createServer(() => undefined); // never answers
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
    const hangUrl = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
    const { child, send } = startMcp(hangUrl);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'approve', arguments: { tool_name: 'Bash', input: {}, tool_use_id: 't' } },
    });
    await new Promise((r) => setTimeout(r, 1500));
    const exited = new Promise<boolean>((r) => {
      child.on('exit', () => r(true));
      setTimeout(() => r(false), 3000);
    });
    child.stdin.end();
    const didExit = await exited;
    child.kill('SIGKILL');
    hang.closeAllConnections();
    hang.close();
    expect(didExit).toBe(true);
  }, 20_000);
});
