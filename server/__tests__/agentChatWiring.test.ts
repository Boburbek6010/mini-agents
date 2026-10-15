import { describe, expect, it, vi } from 'vitest';

import type { AgentChatManager } from '../src/agentChat/manager.js';
import { PermissionBroker } from '../src/agentChat/permissions.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';

function setup(privileged: boolean) {
  const chat = {
    send: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    roster: vi.fn(() => [{ name: 'SMM', status: 'idle', history: [] }]),
  };
  const permissions = new PermissionBroker();
  const sent: Record<string, unknown>[] = [];
  const ctx = {
    store: new AgentStateStore(),
    cache: null,
    privileged,
    chat: chat as unknown as AgentChatManager,
    permissions,
  };
  const handle = (msg: Record<string, unknown>) =>
    handleClientMessage(msg, (m) => sent.push(m), ctx);
  return { chat, permissions, sent, handle };
}

describe('agent chat client messages', () => {
  it('privileged agentChatSend / Stop / Reset reach the manager', () => {
    const { chat, handle } = setup(true);
    handle({ type: 'agentChatSend', agent: 'SMM', text: 'hi' });
    handle({ type: 'agentChatStop', agent: 'SMM' });
    handle({ type: 'agentChatReset', agent: 'SMM' });
    expect(chat.send).toHaveBeenCalledWith('SMM', 'hi');
    expect(chat.stop).toHaveBeenCalledWith('SMM');
    expect(chat.reset).toHaveBeenCalledWith('SMM');
  });

  it('unprivileged chat and permission messages are ignored', async () => {
    const { chat, permissions, handle } = setup(false);
    const decision = permissions.request('SMM', 'Bash', {});
    const id = permissions.pending()[0].id;
    handle({ type: 'agentChatSend', agent: 'SMM', text: 'rm -rf' });
    handle({ type: 'permissionAnswer', id, allow: true });
    expect(chat.send).not.toHaveBeenCalled();
    expect(permissions.pending()).toHaveLength(1);
    permissions.answer(id, false);
    await decision;
  });

  it('empty text is ignored', () => {
    const { chat, handle } = setup(true);
    handle({ type: 'agentChatSend', agent: 'SMM', text: '   ' });
    expect(chat.send).not.toHaveBeenCalled();
  });

  it('permissionAnswer resolves the pending request', async () => {
    const { permissions, handle } = setup(true);
    const decision = permissions.request('SMM', 'Bash', { command: 'ls' });
    handle({ type: 'permissionAnswer', id: permissions.pending()[0].id, allow: true });
    await expect(decision).resolves.toMatchObject({ behavior: 'allow' });
  });

  it('webviewReady sends the roster and re-sends pending permissions', async () => {
    const { permissions, sent, handle } = setup(true);
    const decision = permissions.request('SMM', 'Bash', { command: 'ls' });
    handle({ type: 'webviewReady' });
    expect(sent).toContainEqual({
      type: 'agentChatRoster',
      agents: [{ name: 'SMM', status: 'idle', history: [] }],
    });
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'permissionRequest',
        agent: 'SMM',
        toolName: 'Bash',
        summary: 'Bash: ls',
      }),
    );
    permissions.answer(permissions.pending()[0].id, false);
    await decision;
  });

  it('webviewReady without the token sends no chat roster or pending permissions', async () => {
    const { permissions, sent, handle } = setup(false);
    const decision = permissions.request('SMM', 'Bash', { command: 'ls' });
    handle({ type: 'webviewReady' });
    expect(sent.some((m) => m.type === 'agentChatRoster' || m.type === 'permissionRequest')).toBe(
      false,
    );
    permissions.answer(permissions.pending()[0].id, false);
    await decision;
  });
});
