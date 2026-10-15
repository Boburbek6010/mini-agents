import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';
import { createHttpServer } from '../src/httpServer.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

function collect(url: string): Promise<{ ws: WebSocket; got: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const got: Record<string, unknown>[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString()) as Record<string, unknown>));
    ws.on('open', () => resolve({ ws, got }));
    ws.on('error', reject);
  });
}

describe('privileged-only broadcasts', () => {
  it('reach only sockets opened with the token', async () => {
    const store = new AgentStateStore();
    const { app, port } = await createHttpServer({ embedded: false, token: 'tok', store });
    close = () => app.close();
    const priv = await collect(`ws://127.0.0.1:${port}/ws?token=tok`);
    const anon = await collect(`ws://127.0.0.1:${port}/ws`);
    store.broadcastPrivileged({ type: 'agentChatStatus', agent: 'SMM', status: 'working' });
    store.broadcast({ type: 'agentClosed', id: 1 });
    await new Promise((r) => setTimeout(r, 150));
    expect(priv.got.map((m) => m.type)).toEqual(['agentChatStatus', 'agentClosed']);
    expect(anon.got.map((m) => m.type)).toEqual(['agentClosed']);
    priv.ws.close();
    anon.ws.close();
  });
});
