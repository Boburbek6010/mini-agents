import { afterEach, describe, expect, it } from 'vitest';

import { PermissionBroker } from '../src/agentChat/permissions.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { createHttpServer } from '../src/httpServer.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function start(permissions?: PermissionBroker) {
  const { app, port } = await createHttpServer({
    embedded: true,
    token: 'tok',
    store: new AgentStateStore(),
    permissions,
  });
  close = () => app.close();
  return `http://127.0.0.1:${port}/api/permission`;
}

const post = (url: string, auth: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({ agent: 'SMM', toolName: 'Bash', input: { command: 'ls' } }),
  });

describe('POST /api/permission', () => {
  it('waits for the browser answer and returns the decision', async () => {
    const broker = new PermissionBroker();
    const url = await start(broker);
    const res = post(url, 'Bearer tok');
    await new Promise((r) => setTimeout(r, 100));
    const [req] = broker.pending();
    expect(req).toMatchObject({ agent: 'SMM', toolName: 'Bash' });
    broker.answer(req.id, true);
    const r = await res;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
  });

  it('rejects a wrong token', async () => {
    const url = await start(new PermissionBroker());
    expect((await post(url, 'Bearer nope')).status).toBe(401);
  });

  it('503 when chat is not enabled', async () => {
    const url = await start();
    expect((await post(url, 'Bearer tok')).status).toBe(503);
  });

  it('clears the pending request when the caller disconnects', async () => {
    const broker = new PermissionBroker();
    const url = await start(broker);
    const ctrl = new AbortController();
    const res = fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify({ agent: 'SMM', toolName: 'Bash', input: {} }),
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(broker.pending()).toHaveLength(1);
    ctrl.abort();
    await res;
    await new Promise((r) => setTimeout(r, 100));
    expect(broker.pending()).toEqual([]);
  });
});
