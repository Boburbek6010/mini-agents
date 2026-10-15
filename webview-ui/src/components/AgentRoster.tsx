import { useEffect, useRef, useState } from 'react';

import type { ChatState } from '../hooks/useAgentChat.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

const STATUS_COLOR: Record<string, string> = {
  idle: 'bg-status-success',
  working: 'bg-status-active',
  approval: 'bg-status-permission',
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-label={status}
      className={`inline-block w-8 h-8 shrink-0 ${STATUS_COLOR[status] ?? 'bg-text-muted'}`}
    />
  );
}

interface AgentRosterProps {
  chat: ChatState;
  onOpen: (name: string) => void;
}

/** "Agents" toolbar button: lists configured office agents with status; click opens their chat. */
export function AgentRoster({ chat, onOpen }: AgentRosterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isOpen]);

  if (chat.order.length === 0) return null;
  const waiting = chat.pending.length;

  return (
    <div ref={ref} className="relative">
      <Button variant="accent" onClick={() => setIsOpen((v) => !v)} title="Chat with your agents">
        Agents{waiting > 0 ? ` (${waiting}!)` : ''}
      </Button>
      <Dropdown isOpen={isOpen} className="min-w-128">
        {chat.order.map((name) => (
          <DropdownItem
            key={name}
            onClick={() => {
              setIsOpen(false);
              onOpen(name);
            }}
            className="text-base"
          >
            <span className="flex items-center gap-8">
              <StatusDot status={chat.agents[name]?.status ?? 'idle'} />
              {name}
            </span>
          </DropdownItem>
        ))}
      </Dropdown>
    </div>
  );
}
