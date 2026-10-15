import { useCallback, useEffect, useState } from 'react';

import type { AgentChatStatusValue, ChatItem, ServerMessage } from '../../../core/src/messages.js';
import type { MessageTransport } from '../transport/types.js';

export interface PendingPermission {
  id: string;
  agent: string;
  toolName: string;
  summary: string;
}

export interface AgentChatEntry {
  status: AgentChatStatusValue;
  history: ChatItem[];
}

export interface ChatState {
  order: string[];
  agents: Record<string, AgentChatEntry>;
  pending: PendingPermission[];
}

export const EMPTY_CHAT_STATE: ChatState = { order: [], agents: {}, pending: [] };

function updateAgent(
  state: ChatState,
  name: string,
  fn: (entry: AgentChatEntry) => AgentChatEntry,
): ChatState {
  const entry = state.agents[name];
  if (!entry) return state;
  return { ...state, agents: { ...state.agents, [name]: fn(entry) } };
}

/** Pure reducer: apply one server message to the chat state. Unrelated messages return `state` as-is. */
export function applyChatMessage(state: ChatState, msg: ServerMessage): ChatState {
  switch (msg.type) {
    case 'agentChatRoster':
      return {
        ...state,
        order: msg.agents.map((a) => a.name),
        agents: Object.fromEntries(
          msg.agents.map((a) => [a.name, { status: a.status, history: [...a.history] }]),
        ),
      };
    case 'agentChatEvent':
      return updateAgent(state, msg.agent, (entry) => {
        const last = entry.history.at(-1);
        if (msg.append && last?.role === 'assistant') {
          return {
            ...entry,
            history: [...entry.history.slice(0, -1), { ...last, text: last.text + msg.item.text }],
          };
        }
        return { ...entry, history: [...entry.history, msg.item] };
      });
    case 'agentChatStatus':
      return updateAgent(state, msg.agent, (entry) => ({ ...entry, status: msg.status }));
    case 'agentChatCleared':
      return updateAgent(state, msg.agent, (entry) => ({ ...entry, history: [] }));
    case 'permissionRequest':
      if (state.pending.some((p) => p.id === msg.id)) return state;
      return {
        ...state,
        pending: [
          ...state.pending,
          { id: msg.id, agent: msg.agent, toolName: msg.toolName, summary: msg.summary },
        ],
      };
    case 'permissionResolved':
      return { ...state, pending: state.pending.filter((p) => p.id !== msg.id) };
    default:
      return state;
  }
}

export interface AgentChat {
  state: ChatState;
  open: string | null;
  setOpen: (name: string | null) => void;
  send: (agent: string, text: string) => void;
  stop: (agent: string) => void;
  reset: (agent: string) => void;
  answer: (id: string, allow: boolean) => void;
}

export function useAgentChat(transport: MessageTransport): AgentChat {
  const [state, setState] = useState<ChatState>(EMPTY_CHAT_STATE);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(
    () => transport.onMessage((msg) => setState((s) => applyChatMessage(s, msg))),
    [transport],
  );

  const send = useCallback(
    (agent: string, text: string) => transport.send({ type: 'agentChatSend', agent, text }),
    [transport],
  );
  const stop = useCallback(
    (agent: string) => transport.send({ type: 'agentChatStop', agent }),
    [transport],
  );
  const reset = useCallback(
    (agent: string) => transport.send({ type: 'agentChatReset', agent }),
    [transport],
  );
  const answer = useCallback(
    (id: string, allow: boolean) => transport.send({ type: 'permissionAnswer', id, allow }),
    [transport],
  );

  return { state, open, setOpen, send, stop, reset, answer };
}

// ── Status line shown above an office agent's character ──────────

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + '…';
const baseName = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;
const LOOK_TOOLS = new Set(['Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function toolLine(summary: string): string {
  if (summary.startsWith('Bash: ')) return `Running: ${truncate(summary.slice(6), 40)}`;
  const [name, ...rest] = summary.split(' ');
  const target = rest.join(' ');
  if (name === 'Read' || name === 'NotebookRead') {
    return target ? `Looking at ${baseName(target)}` : 'Looking around the code';
  }
  if (LOOK_TOOLS.has(name)) return 'Looking around the code';
  if (EDIT_TOOLS.has(name)) return target ? `Editing ${baseName(target)}` : 'Editing files';
  return `Using ${name}`;
}

/** Plain-words summary of what an office agent is doing right now. */
export function officeAgentStatusLine(entry: AgentChatEntry, pendingSummary: string): string {
  if (entry.status === 'approval') {
    return pendingSummary ? `Needs approval: ${pendingSummary}` : 'Needs approval';
  }
  const lastUser = entry.history.map((i) => i.role).lastIndexOf('user');
  const turn = lastUser >= 0 ? entry.history.slice(lastUser + 1) : entry.history;
  const last = turn.at(-1);

  if (entry.status === 'working') {
    if (!last || last.role === 'error') {
      const task = lastUser >= 0 ? entry.history[lastUser].text.replace(/\s+/g, ' ') : '';
      return task ? `Started: ${truncate(task, 40)}` : 'Working…';
    }
    if (last.role === 'tool') return toolLine(last.text);
    return 'Writing reply…';
  }

  if (!last) return 'Idle';
  if (last.role === 'error') {
    return last.text === 'Stopped' ? 'Stopped' : `Error: ${truncate(last.text, 50)}`;
  }
  const reply = [...turn].reverse().find((i) => i.role === 'assistant');
  const firstLine = reply?.text
    .split('\n')
    .find((l) => l.trim())
    ?.trim();
  return firstLine ? `Done ✓ ${truncate(firstLine, 50)}` : 'Done ✓';
}
