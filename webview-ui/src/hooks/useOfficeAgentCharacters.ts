import { useEffect, useMemo } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import type { ChatState } from './useAgentChat.js';
import { officeAgentStatusLine } from './useAgentChat.js';

/** Office agents get fixed character ids far above server-assigned ones (which count up from 1). */
const OFFICE_AGENT_ID_BASE = 900_000;
const READING_TOOLS = /^(Read|Grep|Glob|LS|WebSearch|WebFetch|NotebookRead)\b/;

export interface OfficeAgentView {
  name: string;
  id: number;
  text: string;
  active: boolean;
  /** Reading animation instead of typing. */
  reading: boolean;
  permission: boolean;
  dot: string | null;
}

/** Pure: one fixed-character view per configured office agent, in roster order. */
export function officeAgentViews(state: ChatState): OfficeAgentView[] {
  return state.order.flatMap((name, i) => {
    const entry = state.agents[name];
    if (!entry) return [];
    const pending = state.pending.find((p) => p.agent === name);
    const lastTool = [...entry.history].reverse().find((h) => h.role === 'tool');
    const active = entry.status !== 'idle';
    const permission = entry.status === 'approval';
    return [
      {
        name,
        id: OFFICE_AGENT_ID_BASE + i,
        text: officeAgentStatusLine(entry, pending?.summary ?? ''),
        active,
        reading: active && !permission && !!lastTool && READING_TOOLS.test(lastTool.text),
        permission,
        dot: permission
          ? 'var(--color-status-permission)'
          : active
            ? 'var(--color-status-active)'
            : null,
      },
    ];
  });
}

/**
 * Keeps one permanent, labeled character per office agent in the office and
 * animates it from that agent's chat (working / reading / needs approval).
 */
export function useOfficeAgentCharacters(os: OfficeState, state: ChatState): OfficeAgentView[] {
  const views = useMemo(() => officeAgentViews(state), [state]);

  useEffect(() => {
    const wanted = new Set(views.map((v) => v.id));
    for (const v of views) {
      if (!os.characters.has(v.id))
        os.addAgent(v.id, undefined, undefined, undefined, true, v.name);
    }
    for (const id of [...os.characters.keys()]) {
      if (id >= OFFICE_AGENT_ID_BASE && !wanted.has(id)) os.removeAgent(id);
    }
  }, [os, views]);

  useEffect(() => {
    for (const v of views) {
      if (!os.characters.has(v.id)) continue;
      os.setAgentActive(v.id, v.active);
      os.setAgentTool(v.id, v.reading ? 'Read' : null);
      if (v.permission) os.showPermissionBubble(v.id);
      else os.clearPermissionBubble(v.id);
    }
  }, [os, views]);

  return views;
}
