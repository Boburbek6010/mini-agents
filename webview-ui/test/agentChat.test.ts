import { describe, expect, it } from 'vitest';

import type { ChatState } from '../src/hooks/useAgentChat.js';
import { applyChatMessage, EMPTY_CHAT_STATE } from '../src/hooks/useAgentChat.js';

const item = (role: 'user' | 'assistant' | 'tool' | 'error', text: string) => ({
  role,
  text,
  ts: 1,
});
const roster: ChatState = applyChatMessage(EMPTY_CHAT_STATE, {
  type: 'agentChatRoster',
  agents: [
    { name: 'Xurshidjon', status: 'idle', history: [item('user', 'hi')] },
    { name: 'SMM', status: 'working', history: [] },
  ],
});

describe('applyChatMessage', () => {
  it('loads the roster in order', () => {
    expect(roster.order).toEqual(['Xurshidjon', 'SMM']);
    expect(roster.agents.SMM.status).toBe('working');
    expect(roster.agents.Xurshidjon.history).toEqual([item('user', 'hi')]);
  });

  it('append extends the last assistant item', () => {
    let s = applyChatMessage(roster, {
      type: 'agentChatEvent',
      agent: 'SMM',
      item: item('assistant', 'Hel'),
    });
    s = applyChatMessage(s, {
      type: 'agentChatEvent',
      agent: 'SMM',
      item: item('assistant', 'lo'),
      append: true,
    });
    expect(s.agents.SMM.history).toEqual([item('assistant', 'Hello')]);
  });

  it('non-append adds an item and does not mutate the previous state', () => {
    const s = applyChatMessage(roster, {
      type: 'agentChatEvent',
      agent: 'SMM',
      item: item('tool', 'Bash: ls'),
    });
    expect(s.agents.SMM.history).toEqual([item('tool', 'Bash: ls')]);
    expect(roster.agents.SMM.history).toEqual([]);
  });

  it('status update', () => {
    const s = applyChatMessage(roster, {
      type: 'agentChatStatus',
      agent: 'SMM',
      status: 'approval',
    });
    expect(s.agents.SMM.status).toBe('approval');
  });

  it('cleared empties the history', () => {
    const s = applyChatMessage(roster, { type: 'agentChatCleared', agent: 'Xurshidjon' });
    expect(s.agents.Xurshidjon.history).toEqual([]);
  });

  it('permission request adds, resolved removes, duplicates ignored', () => {
    const req = {
      type: 'permissionRequest' as const,
      id: 'p1',
      agent: 'SMM',
      toolName: 'Bash',
      summary: 'Bash: ls',
    };
    let s = applyChatMessage(roster, req);
    s = applyChatMessage(s, req);
    expect(s.pending).toEqual([{ id: 'p1', agent: 'SMM', toolName: 'Bash', summary: 'Bash: ls' }]);
    s = applyChatMessage(s, { type: 'permissionResolved', id: 'p1' });
    expect(s.pending).toEqual([]);
  });

  it('events for unknown agents are ignored; unrelated messages return the same state', () => {
    const s = applyChatMessage(roster, {
      type: 'agentChatEvent',
      agent: 'Nobody',
      item: item('error', 'Unknown agent'),
    });
    expect(s).toBe(roster);
    expect(applyChatMessage(roster, { type: 'agentClosed', id: 1 })).toBe(roster);
  });
});
