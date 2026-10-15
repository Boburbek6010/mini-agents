#!/usr/bin/env node
// Fake `claude` for AgentChatManager tests. Scenario via FAKE_SCENARIO; logs argv/cwd to FAKE_LOG.
import * as fs from 'fs';

const log = (o) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + '\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const delta = (text) =>
  out({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  });
log({ argv: process.argv.slice(2), cwd: process.cwd() });

const scenario = process.env.FAKE_SCENARIO ?? 'ok';
if (scenario === 'ok') {
  out({ type: 'system', subtype: 'init', session_id: process.env.FAKE_SESSION ?? 'sess-1' });
  delta('Hel');
  delta('lo');
  out({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
  });
  out({
    type: 'result',
    is_error: false,
    result: 'Hello',
    session_id: process.env.FAKE_SESSION ?? 'sess-1',
  });
  process.exit(0);
} else if (scenario === 'fail') {
  process.stderr.write('boom: something broke\n');
  process.exit(3);
} else if (scenario === 'login') {
  out({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' });
  process.exit(1);
} else if (scenario === 'slow') {
  out({ type: 'system', subtype: 'init', session_id: 'sess-slow' });
  process.on('SIGINT', () => {
    log({ signal: 'SIGINT' });
    // Real claude reports an interrupted turn as an error result before exiting.
    out({ type: 'result', is_error: true, result: '' });
    process.exit(130);
  });
  setInterval(() => {}, 1000);
}
if (scenario === 'stubborn') {
  out({ type: 'system', subtype: 'init', session_id: 'sess-stubborn' });
  process.on('SIGINT', () => log({ signal: 'SIGINT-ignored' }));
  setInterval(() => {}, 1000);
}
