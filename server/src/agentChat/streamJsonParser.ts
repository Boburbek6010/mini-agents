/**
 * Turns `claude -p --output-format stream-json --verbose --include-partial-messages`
 * lines into chat events. Text comes only from streamed deltas (full assistant
 * messages repeat it); tool rows come from main-conversation tool_use blocks.
 */

export type ChatEvent =
  | { kind: 'init'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'result'; isError: boolean; text: string; sessionId?: string }
  | { kind: 'error'; text: string };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const BASH_MAX = 80;

export function summarizeTool(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && typeof input.command === 'string') {
    const cmd = input.command.replace(/\s+/g, ' ').trim();
    return `Bash: ${cmd.length > BASH_MAX ? cmd.slice(0, BASH_MAX) + '…' : cmd}`;
  }
  if (FILE_TOOLS.has(name)) {
    const p = input.file_path ?? input.notebook_path;
    if (typeof p === 'string') return `${name} ${p}`;
  }
  return name;
}

export function parseStreamJsonLine(line: string): ChatEvent[] {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(msg)) return [];

  switch (msg.type) {
    case 'system':
      return msg.subtype === 'init' && typeof msg.session_id === 'string'
        ? [{ kind: 'init', sessionId: msg.session_id }]
        : [];

    case 'stream_event': {
      const ev = msg.event;
      if (isObj(ev) && ev.type === 'content_block_delta' && isObj(ev.delta)) {
        if (ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') {
          return [{ kind: 'text', text: ev.delta.text }];
        }
      }
      return [];
    }

    case 'assistant': {
      if (msg.parent_tool_use_id) return [];
      const content = isObj(msg.message) ? msg.message.content : undefined;
      if (!Array.isArray(content)) return [];
      return content.flatMap((block): ChatEvent[] => {
        if (!isObj(block) || block.type !== 'tool_use' || typeof block.name !== 'string') return [];
        const input = isObj(block.input) ? block.input : {};
        return [{ kind: 'tool', name: block.name, summary: summarizeTool(block.name, input) }];
      });
    }

    case 'result':
      return [
        {
          kind: 'result',
          isError: msg.is_error === true,
          text: typeof msg.result === 'string' ? msg.result : '',
          sessionId: typeof msg.session_id === 'string' ? msg.session_id : undefined,
        },
      ];

    default:
      return [];
  }
}
