import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatServerMessage } from '../src/agentChat/manager.js';
import { AgentChatManager } from '../src/agentChat/manager.js';
import { PermissionBroker } from '../src/agentChat/permissions.js';

const FAKE = path.join(__dirname, 'fixtures/fake-claude.mjs');
let dir: string;
let logFile: string;
let msgs: ChatServerMessage[];
let broker: PermissionBroker;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmgr-'));
  fs.mkdirSync(path.join(dir, 'ITERA GREEN'));
  logFile = path.join(dir, 'fake.log');
  msgs = [];
  broker = new PermissionBroker();
  process.env.FAKE_LOG = logFile;
  process.env.FAKE_SCENARIO = 'ok';
  delete process.env.FAKE_SESSION;
});
afterEach(() => {
  delete process.env.FAKE_SCENARIO;
});

function make(claudeBin = FAKE) {
  return new AgentChatManager({
    agents: [{ name: 'X', cwd: path.join(dir, 'ITERA GREEN') }],
    claudeBin,
    mcpScript: '/dist/hooks/office-permission-mcp.js',
    officeUrl: 'http://127.0.0.1:3100',
    token: 'tok',
    stateFile: path.join(dir, 'data', 'chat-sessions.json'),
    broker,
    emit: (m) => msgs.push(m),
  });
}
const statusOf = () =>
  msgs
    .filter((m) => m.type === 'agentChatStatus')
    .map((m) => m.type === 'agentChatStatus' && m.status);
const fakeRuns = () =>
  fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { argv?: string[]; cwd?: string; signal?: string });
async function idle(m: AgentChatManager) {
  for (let i = 0; i < 200 && m.roster()[0].status !== 'idle'; i++)
    await new Promise((r) => setTimeout(r, 20));
}

describe('AgentChatManager', () => {
  it('runs a turn: user item, streamed text, tool row, working→idle, session saved', async () => {
    const m = make();
    m.send('X', 'hi');
    await idle(m);
    const items = m.roster()[0].history.map((i) => [i.role, i.text]);
    expect(items).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello'],
      ['tool', 'Bash: ls'],
    ]);
    expect(statusOf()).toEqual(['working', 'idle']);
    expect(msgs.some((x) => x.type === 'agentChatEvent' && x.append === true)).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'data', 'chat-sessions.json'), 'utf8')),
    ).toEqual({ X: 'sess-1' });
    const [run] = fakeRuns();
    expect(run.argv).toEqual(
      expect.arrayContaining(['-p', 'hi', '--permission-prompt-tool', 'mcp__office__approve']),
    );
    expect(run.argv).not.toContain('--bare');
    expect(run.argv).not.toContain('--resume');
  });

  it('second send resumes the session', async () => {
    const m = make();
    m.send('X', 'one');
    await idle(m);
    m.send('X', 'two');
    await idle(m);
    expect(fakeRuns()[1].argv).toEqual(expect.arrayContaining(['--resume', 'sess-1']));
  });

  it('runs in the agent cwd even with spaces', async () => {
    const m = make();
    m.send('X', 'hi');
    await idle(m);
    expect(fs.realpathSync(fakeRuns()[0].cwd ?? '')).toBe(
      fs.realpathSync(path.join(dir, 'ITERA GREEN')),
    );
  });

  it('busy → error item, nothing queued', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const m = make();
    m.send('X', 'a');
    m.send('X', 'b');
    const errs = m
      .roster()[0]
      .history.filter((i) => i.role === 'error')
      .map((i) => i.text);
    expect(errs).toEqual(['Agent is busy — wait or press Stop']);
    m.stop('X');
    await idle(m);
  });

  it('missing claude binary → error item mentioning claude, back to idle', async () => {
    const m = make('/nope/claude');
    m.send('X', 'hi');
    await idle(m);
    const err = m.roster()[0].history.find((i) => i.role === 'error');
    expect(err?.text).toMatch(/claude/);
    expect(m.roster()[0].status).toBe('idle');
  });

  it('non-zero exit → error item with stderr', async () => {
    process.env.FAKE_SCENARIO = 'fail';
    const m = make();
    m.send('X', 'hi');
    await idle(m);
    expect(m.roster()[0].history.at(-1)).toMatchObject({
      role: 'error',
      text: expect.stringContaining('boom: something broke'),
    });
  });

  it('error result (e.g. login expired) → error item', async () => {
    process.env.FAKE_SCENARIO = 'login';
    const m = make();
    m.send('X', 'hi');
    await idle(m);
    expect(m.roster()[0].history.at(-1)).toMatchObject({
      role: 'error',
      text: expect.stringContaining('Not logged in'),
    });
  });

  it('stop sends SIGINT', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const m = make();
    m.send('X', 'hi');
    await new Promise((r) => setTimeout(r, 300));
    m.stop('X');
    await idle(m);
    expect(fakeRuns().some((r) => r.signal === 'SIGINT')).toBe(true);
  });

  it('reset clears history and the next run has no --resume', async () => {
    const m = make();
    m.send('X', 'one');
    await idle(m);
    m.reset('X');
    expect(m.roster()[0].history).toEqual([]);
    expect(msgs.at(-1)).toEqual({ type: 'agentChatCleared', agent: 'X' });
    m.send('X', 'two');
    await idle(m);
    expect(fakeRuns()[1].argv).not.toContain('--resume');
  });

  it('unknown agent → error event', () => {
    const m = make();
    m.send('Nobody', 'hi');
    expect(msgs).toEqual([
      {
        type: 'agentChatEvent',
        agent: 'Nobody',
        item: expect.objectContaining({ role: 'error', text: 'Unknown agent' }),
      },
    ]);
  });

  it('caps history at 200 items', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const m = make();
    m.send('X', 'start');
    for (let i = 0; i < 250; i++) m.send('X', 'x');
    expect(m.roster()[0].history.length).toBe(200);
    m.stop('X');
    await idle(m);
  });

  it('loads saved sessions from the state file', async () => {
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(
      path.join(dir, 'data', 'chat-sessions.json'),
      JSON.stringify({ X: 'old-sess' }),
    );
    const m = make();
    m.send('X', 'hi');
    await idle(m);
    expect(fakeRuns()[0].argv).toEqual(expect.arrayContaining(['--resume', 'old-sess']));
  });

  it('setStatus is ignored while no turn is running', () => {
    const m = make();
    m.setStatus('X', 'working');
    m.setStatus('X', 'approval');
    expect(m.roster()[0].status).toBe('idle');
    expect(msgs).toEqual([]);
  });

  it('a message starting with a dash is passed after -- so it is not read as a flag', async () => {
    const m = make();
    m.send('X', '-x hi');
    await idle(m);
    const argv = fakeRuns()[0].argv ?? [];
    expect(argv.slice(-2)).toEqual(['--', '-x hi']);
    expect(argv).toContain('-p');
  });

  it('stopAll interrupts running turns and resolves once they exit', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const m = make();
    m.send('X', 'hi');
    await new Promise((r) => setTimeout(r, 300));
    await m.stopAll(2000);
    expect(m.roster()[0].status).toBe('idle');
    expect(fakeRuns().some((r) => r.signal === 'SIGINT')).toBe(true);
  });

  it('stopAll force-kills a child that ignores SIGINT', async () => {
    process.env.FAKE_SCENARIO = 'stubborn';
    const m = make();
    m.send('X', 'hi');
    await new Promise((r) => setTimeout(r, 300));
    await m.stopAll(200);
    expect(m.roster()[0].status).toBe('idle');
  });

  it('stopping shows only "Stopped", not an extra error from the interrupted result', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const m = make();
    m.send('X', 'hi');
    await new Promise((r) => setTimeout(r, 300));
    m.stop('X');
    await idle(m);
    const errors = m
      .roster()[0]
      .history.filter((i) => i.role === 'error')
      .map((i) => i.text);
    expect(errors).toEqual(['Stopped']);
  });
});
