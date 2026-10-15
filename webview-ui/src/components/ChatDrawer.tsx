import { useEffect, useRef, useState } from 'react';

import type { AgentChat } from '../hooks/useAgentChat.js';
import { StatusDot } from './AgentRoster.js';
import { Button } from './ui/Button.js';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Ready',
  working: 'Working…',
  approval: 'Needs your approval',
};

/** Right-side chat panel for one office agent. */
export function ChatDrawer({ chat }: { chat: AgentChat }) {
  const name = chat.open;
  const entry = name ? chat.state.agents[name] : undefined;
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyLength = entry?.history.length ?? 0;
  const lastText = entry?.history.at(-1)?.text.length ?? 0;
  const pending = chat.state.pending.filter((p) => p.agent === name);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [historyLength, lastText, pending.length, name]);

  if (!name || !entry) return null;
  const busy = entry.status !== 'idle';

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    chat.send(name, text);
    setDraft('');
  };

  return (
    <div
      className="absolute top-10 right-10 bottom-10 z-30 flex flex-col pixel-panel p-8"
      style={{ width: 'min(440px, calc(100vw - 20px))' }}
      role="dialog"
      aria-label={`Chat with ${name}`}
    >
      <div className="flex items-center gap-8 pb-8 border-b-2 border-border">
        <StatusDot status={entry.status} />
        <div className="flex-1 min-w-0">
          <div className="text-xl truncate">{name}</div>
          <div className="text-xs text-text-muted">{STATUS_LABEL[entry.status]}</div>
        </div>
        <Button size="sm" onClick={() => chat.reset(name)} disabled={busy} title="Start a new chat">
          New chat
        </Button>
        <Button size="sm" variant="ghost" onClick={() => chat.setOpen(null)} title="Close">
          ✕
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pixel-scrollbar py-8 flex flex-col gap-6"
      >
        {entry.history.length === 0 && (
          <div className="text-text-muted text-sm text-center mt-16">
            Give {name} a task to get started.
          </div>
        )}
        {entry.history.map((item, i) => {
          if (item.role === 'user') {
            return (
              <div
                key={i}
                className="self-end max-w-[85%] bg-active-bg px-8 py-4 whitespace-pre-wrap break-words"
              >
                {item.text}
              </div>
            );
          }
          if (item.role === 'tool') {
            return (
              <div key={i} className="text-text-muted text-sm font-mono truncate" title={item.text}>
                ▸ {item.text}
              </div>
            );
          }
          if (item.role === 'error') {
            return (
              <div key={i} className="text-danger text-sm whitespace-pre-wrap break-words">
                {item.text}
              </div>
            );
          }
          return (
            <div key={i} className="whitespace-pre-wrap break-words">
              {item.text}
            </div>
          );
        })}
        {pending.map((p) => (
          <div key={p.id} className="border-2 border-status-permission p-8 flex flex-col gap-6">
            <div className="text-sm text-text-muted">{name} wants to run:</div>
            <div className="font-mono text-sm break-words">{p.summary}</div>
            <div className="flex gap-8">
              <Button size="sm" variant="accent" onClick={() => chat.answer(p.id, true)}>
                Allow
              </Button>
              <Button size="sm" onClick={() => chat.answer(p.id, false)}>
                Deny
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-8 pt-8 border-t-2 border-border items-end">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder={busy ? `${name} is working…` : `Message ${name}`}
          className="flex-1 resize-none bg-bg-dark border-2 border-border p-6 text-base text-text outline-none focus:border-accent"
        />
        {busy ? (
          <Button onClick={() => chat.stop(name)} title="Stop the agent">
            Stop
          </Button>
        ) : (
          <Button variant="accent" onClick={submit} disabled={!draft.trim()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
