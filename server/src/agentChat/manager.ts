/**
 * Runs office agents as headless `claude -p` processes, one turn at a time per
 * agent, and turns their stream-json output into chat items for the browser.
 * Conversation memory comes from `--resume <sessionId>`; session ids survive
 * server restarts via `stateFile`.
 */
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import type { OfficeAgent } from '../agentConfig.js';
import type { PermissionBroker } from './permissions.js';
import { parseStreamJsonLine } from './streamJsonParser.js';

export type AgentStatus = 'idle' | 'working' | 'approval';

export interface ChatItem {
  role: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  ts: number;
}

export type ChatServerMessage =
  | { type: 'agentChatEvent'; agent: string; item: ChatItem; append?: boolean }
  | { type: 'agentChatStatus'; agent: string; status: AgentStatus }
  | { type: 'agentChatCleared'; agent: string };

export interface AgentChatManagerOptions {
  agents: OfficeAgent[];
  claudeBin: string;
  mcpScript: string;
  officeUrl: string;
  token: string;
  stateFile: string;
  broker: PermissionBroker;
  emit: (m: ChatServerMessage) => void;
}

const HISTORY_CAP = 200;
const STDERR_TAIL = 800;
const BUSY_TEXT = 'Agent is busy — wait or press Stop';

interface AgentEntry {
  agent: OfficeAgent;
  status: AgentStatus;
  history: ChatItem[];
  child?: ChildProcess;
  stopped?: boolean;
}

export class AgentChatManager {
  private readonly entries = new Map<string, AgentEntry>();
  private sessions: Record<string, string>;

  constructor(private readonly opts: AgentChatManagerOptions) {
    for (const agent of opts.agents) {
      this.entries.set(agent.name, { agent, status: 'idle', history: [] });
    }
    this.sessions = this.loadSessions();
  }

  roster(): { name: string; status: AgentStatus; history: ChatItem[] }[] {
    return [...this.entries.values()].map((e) => ({
      name: e.agent.name,
      status: e.status,
      history: [...e.history],
    }));
  }

  /** Called by the server wiring while a permission request is pending / resolved. */
  setStatus(name: string, status: AgentStatus): void {
    const entry = this.entries.get(name);
    if (!entry || entry.status === status) return;
    // Only a running turn can be working or waiting for approval.
    if (status !== 'idle' && !entry.child) return;
    entry.status = status;
    this.opts.emit({ type: 'agentChatStatus', agent: name, status });
  }

  send(name: string, text: string): void {
    const entry = this.entries.get(name);
    if (!entry) {
      this.opts.emit({ type: 'agentChatEvent', agent: name, item: item('error', 'Unknown agent') });
      return;
    }
    if (entry.child) {
      this.push(entry, item('error', BUSY_TEXT));
      return;
    }
    this.push(entry, item('user', text));
    this.run(entry, text);
  }

  stop(name: string): void {
    const entry = this.entries.get(name);
    if (!entry?.child) return;
    entry.stopped = true;
    this.opts.broker.cancelAgent(name);
    entry.child.kill('SIGINT');
  }

  /**
   * Stop every running turn (server shutdown): deny pending approvals, SIGINT,
   * then SIGKILL anything still alive after `graceMs`. Resolves once all exited.
   */
  async stopAll(graceMs = 3000): Promise<void> {
    const running = [...this.entries.values()].filter((e) => e.child);
    await Promise.all(
      running.map(
        (entry) =>
          new Promise<void>((resolve) => {
            const child = entry.child!;
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            const kill = setTimeout(() => child.kill('SIGKILL'), graceMs);
            child.once('close', () => {
              clearTimeout(kill);
              resolve();
            });
            this.stop(entry.agent.name);
          }),
      ),
    );
  }

  reset(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (entry.child) {
      this.push(entry, item('error', 'Stop the agent before starting a new chat'));
      return;
    }
    entry.history = [];
    delete this.sessions[name];
    this.saveSessions();
    this.opts.emit({ type: 'agentChatCleared', agent: name });
  }

  // ── internals ──────────────────────────────────────────────

  private run(entry: AgentEntry, text: string): void {
    const name = entry.agent.name;
    const sessionId = this.sessions[name];
    const mcpConfig = {
      mcpServers: {
        office: {
          command: process.execPath,
          args: [this.opts.mcpScript],
          env: {
            OFFICE_URL: this.opts.officeUrl,
            OFFICE_TOKEN: this.opts.token,
            OFFICE_AGENT: name,
          },
        },
      },
    };
    // The prompt goes last, after `--`, so text like "- add tests" is never parsed as a flag.
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'default',
      '--permission-prompt-tool',
      'mcp__office__approve',
      '--mcp-config',
      JSON.stringify(mcpConfig),
      ...(sessionId ? ['--resume', sessionId] : []),
      '--',
      text,
    ];

    entry.stopped = false;
    this.setRunning(entry, 'working');

    let child: ChildProcess;
    try {
      child = spawn(this.opts.claudeBin, args, {
        cwd: entry.agent.cwd,
        env: { ...process.env, MCP_TOOL_TIMEOUT: '600000' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      this.failStart(entry, err as NodeJS.ErrnoException);
      return;
    }
    entry.child = child;

    let stderr = '';
    let sawResult = false;
    let streamedText = false;
    let lastAssistant: ChatItem | undefined;

    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-STDERR_TAIL);
    });

    readline.createInterface({ input: child.stdout! }).on('line', (line) => {
      for (const ev of parseStreamJsonLine(line)) {
        switch (ev.kind) {
          case 'init':
            this.saveSession(name, ev.sessionId);
            break;
          case 'text':
            streamedText = true;
            if (lastAssistant) {
              lastAssistant.text += ev.text;
              this.opts.emit({
                type: 'agentChatEvent',
                agent: name,
                item: { ...lastAssistant, text: ev.text },
                append: true,
              });
            } else {
              lastAssistant = item('assistant', ev.text);
              this.push(entry, lastAssistant);
            }
            break;
          case 'tool':
            lastAssistant = undefined;
            this.push(entry, item('tool', ev.summary));
            break;
          case 'result':
            sawResult = true;
            if (ev.sessionId) this.saveSession(name, ev.sessionId);
            // After Stop, claude reports the interrupted turn as an error; "Stopped" covers it.
            if (ev.isError) {
              if (!entry.stopped) {
                this.push(entry, item('error', ev.text || 'The agent reported an error'));
              }
            } else if (!streamedText && ev.text) this.push(entry, item('assistant', ev.text));
            break;
          case 'error':
            this.push(entry, item('error', ev.text));
            break;
        }
      }
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (entry.child !== child) return;
      entry.child = undefined;
      this.failStart(entry, err);
    });

    child.on('close', (code) => {
      if (entry.child !== child) return;
      entry.child = undefined;
      if (entry.stopped) this.push(entry, item('error', 'Stopped'));
      else if (code !== 0 && !sawResult) {
        const tail = stderr.trim();
        this.push(
          entry,
          item('error', `claude exited with code ${code}${tail ? `: ${tail}` : ''}`),
        );
      }
      this.setRunning(entry, 'idle');
    });
  }

  private failStart(entry: AgentEntry, err: NodeJS.ErrnoException): void {
    this.push(
      entry,
      item(
        'error',
        `Could not start claude (${err.code ?? err.message}). Is Claude Code installed and on PATH?`,
      ),
    );
    this.setRunning(entry, 'idle');
  }

  private setRunning(entry: AgentEntry, status: AgentStatus): void {
    entry.status = status;
    this.opts.emit({ type: 'agentChatStatus', agent: entry.agent.name, status });
  }

  private push(entry: AgentEntry, chatItem: ChatItem): void {
    entry.history.push(chatItem);
    if (entry.history.length > HISTORY_CAP)
      entry.history.splice(0, entry.history.length - HISTORY_CAP);
    this.opts.emit({ type: 'agentChatEvent', agent: entry.agent.name, item: { ...chatItem } });
  }

  private loadSessions(): Record<string, string> {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.opts.stateFile, 'utf8'));
      return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private saveSession(name: string, sessionId: string): void {
    if (this.sessions[name] === sessionId) return;
    this.sessions[name] = sessionId;
    this.saveSessions();
  }

  private saveSessions(): void {
    try {
      fs.mkdirSync(path.dirname(this.opts.stateFile), { recursive: true });
      fs.writeFileSync(this.opts.stateFile, JSON.stringify(this.sessions, null, 2));
    } catch (err) {
      console.warn(`[Pixel Agents] Could not save chat sessions: ${(err as Error).message}`);
    }
  }
}

function item(role: ChatItem['role'], text: string): ChatItem {
  return { role, text, ts: Date.now() };
}
