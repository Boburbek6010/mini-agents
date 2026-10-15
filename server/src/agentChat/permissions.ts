/**
 * Holds permission requests from headless agents until the office user answers
 * Allow / Deny in the browser. Unanswered requests auto-deny after 10 minutes.
 */
import * as crypto from 'crypto';

import { summarizeTool } from './streamJsonParser.js';

export type PermissionDecision =
  { behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string };

export interface PendingPermission {
  id: string;
  agent: string;
  toolName: string;
  summary: string;
}

export type PermissionChange =
  { type: 'requested'; req: PendingPermission } | { type: 'resolved'; id: string };

const DEFAULT_TIMEOUT_MS = 600_000;
const TIMEOUT_MESSAGE = 'No answer from the office within 10 minutes';
const DENY_MESSAGE = 'Denied in the office';
const CANCEL_MESSAGE = 'Stopped in the office';

interface Entry {
  req: PendingPermission;
  input: unknown;
  resolve: (d: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PermissionBroker {
  private readonly entries = new Map<string, Entry>();
  private readonly timeoutMs: number;
  private readonly onChange?: (e: PermissionChange) => void;

  constructor(opts?: { timeoutMs?: number; onChange?: (e: PermissionChange) => void }) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onChange = opts?.onChange;
  }

  /** `signal` aborting (the requesting agent went away) denies and clears the request. */
  request(
    agent: string,
    toolName: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<PermissionDecision> {
    const id = crypto.randomUUID();
    const summary = summarizeTool(
      toolName,
      input && typeof input === 'object' ? (input as Record<string, unknown>) : {},
    );
    const req: PendingPermission = { id, agent, toolName, summary };
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.settle(id, { behavior: 'deny', message: TIMEOUT_MESSAGE }),
        this.timeoutMs,
      );
      this.entries.set(id, { req, input, resolve, timer });
      this.onChange?.({ type: 'requested', req });
      signal?.addEventListener('abort', () => this.cancel(id), { once: true });
    });
  }

  answer(id: string, allow: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.settle(
      id,
      allow
        ? { behavior: 'allow', updatedInput: entry.input }
        : { behavior: 'deny', message: DENY_MESSAGE },
    );
    return true;
  }

  /** Deny and clear one request (its requester disconnected). False if unknown. */
  cancel(id: string): boolean {
    if (!this.entries.has(id)) return false;
    this.settle(id, { behavior: 'deny', message: CANCEL_MESSAGE });
    return true;
  }

  pending(): PendingPermission[] {
    return [...this.entries.values()].map((e) => e.req);
  }

  cancelAgent(agent: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.req.agent === agent) this.settle(id, { behavior: 'deny', message: CANCEL_MESSAGE });
    }
  }

  private settle(id: string, decision: PermissionDecision): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    entry.resolve(decision);
    this.onChange?.({ type: 'resolved', id });
  }
}
