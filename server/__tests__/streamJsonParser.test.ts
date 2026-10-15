import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '../src/agentChat/streamJsonParser.js';
import { parseStreamJsonLine, summarizeTool } from '../src/agentChat/streamJsonParser.js';

const line = (o: unknown): string => JSON.stringify(o);
const delta = (text: string) =>
  line({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  });

describe('parseStreamJsonLine', () => {
  it('init line → session id', () => {
    expect(
      parseStreamJsonLine(line({ type: 'system', subtype: 'init', session_id: 'abc' })),
    ).toEqual([{ kind: 'init', sessionId: 'abc' }]);
  });

  it('text deltas → text events', () => {
    expect([...parseStreamJsonLine(delta('Hel')), ...parseStreamJsonLine(delta('lo'))]).toEqual([
      { kind: 'text', text: 'Hel' },
      { kind: 'text', text: 'lo' },
    ]);
  });

  it('assistant tool_use → tool row', () => {
    const l = line({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'flutter test' } }],
      },
    });
    expect(parseStreamJsonLine(l)).toEqual([
      { kind: 'tool', name: 'Bash', summary: 'Bash: flutter test' },
    ]);
  });

  it('assistant text is ignored (deltas carry it)', () => {
    const l = line({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    expect(parseStreamJsonLine(l)).toEqual([]);
  });

  it('subagent tool_use is ignored', () => {
    const l = line({
      type: 'assistant',
      parent_tool_use_id: 'toolu_x',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a' } }] },
    });
    expect(parseStreamJsonLine(l)).toEqual([]);
  });

  it('result success and error', () => {
    expect(
      parseStreamJsonLine(
        line({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'done',
          session_id: 's',
        }),
      ),
    ).toEqual([{ kind: 'result', isError: false, text: 'done', sessionId: 's' }]);
    expect(
      parseStreamJsonLine(
        line({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          result: 'Not logged in',
        }),
      ),
    ).toEqual([{ kind: 'result', isError: true, text: 'Not logged in', sessionId: undefined }]);
  });

  it('garbage → []', () => {
    expect(parseStreamJsonLine('not json')).toEqual([]);
    expect(parseStreamJsonLine('')).toEqual([]);
    expect(parseStreamJsonLine('null')).toEqual([]);
  });

  it('real fixture → init, tool, streamed text, result', () => {
    const file = path.join(__dirname, 'fixtures/stream-json/write-allow.jsonl');
    const events: ChatEvent[] = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap(parseStreamJsonLine);
    expect(events[0]).toEqual({ kind: 'init', sessionId: 'sess-123' });
    expect(events.filter((e) => e.kind === 'tool')).toEqual([
      { kind: 'tool', name: 'Write', summary: 'Write /proj/hello.txt' },
    ]);
    const text = events.flatMap((e) => (e.kind === 'text' ? [e.text] : [])).join('');
    const result = events.find((e) => e.kind === 'result');
    expect(result).toMatchObject({ kind: 'result', isError: false, sessionId: 'sess-123' });
    expect(text).toBe(result?.kind === 'result' ? result.text : '');
  });
});

describe('summarizeTool', () => {
  it('Bash truncates to 80 chars', () => {
    expect(summarizeTool('Bash', { command: 'x'.repeat(100) })).toBe(
      'Bash: ' + 'x'.repeat(80) + '…',
    );
  });
  it('file tools show the path', () => {
    expect(summarizeTool('Edit', { file_path: '/a/b.dart' })).toBe('Edit /a/b.dart');
  });
  it('other tools show the name', () => {
    expect(summarizeTool('WebSearch', { query: 'x' })).toBe('WebSearch');
  });
});
