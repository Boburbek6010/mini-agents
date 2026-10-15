import { describe, expect, it } from 'vitest';

import { PermissionBroker } from '../src/agentChat/permissions.js';

describe('PermissionBroker', () => {
  it('allow resolves with the original input', async () => {
    const b = new PermissionBroker();
    const p = b.request('SMM', 'Bash', { command: 'ls' });
    const [req] = b.pending();
    expect(req).toMatchObject({ agent: 'SMM', toolName: 'Bash', summary: 'Bash: ls' });
    expect(b.answer(req.id, true)).toBe(true);
    await expect(p).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    expect(b.pending()).toEqual([]);
  });

  it('deny resolves with the office message', async () => {
    const b = new PermissionBroker();
    const p = b.request('SMM', 'Bash', { command: 'rm x' });
    b.answer(b.pending()[0].id, false);
    await expect(p).resolves.toEqual({ behavior: 'deny', message: 'Denied in the office' });
  });

  it('times out to deny', async () => {
    const b = new PermissionBroker({ timeoutMs: 20 });
    await expect(b.request('SMM', 'Bash', {})).resolves.toEqual({
      behavior: 'deny',
      message: 'No answer from the office within 10 minutes',
    });
    expect(b.pending()).toEqual([]);
  });

  it('unknown id → false', () => {
    expect(new PermissionBroker().answer('nope', true)).toBe(false);
  });

  it('cancelAgent denies only that agent', async () => {
    const b = new PermissionBroker();
    const a = b.request('A', 'Bash', {});
    b.request('B', 'Bash', {});
    b.cancelAgent('A');
    await expect(a).resolves.toMatchObject({ behavior: 'deny' });
    expect(b.pending().map((p) => p.agent)).toEqual(['B']);
  });

  it('onChange fires requested then resolved', async () => {
    const events: string[] = [];
    const b = new PermissionBroker({ onChange: (e) => events.push(e.type) });
    const p = b.request('A', 'Bash', {});
    b.answer(b.pending()[0].id, true);
    await p;
    expect(events).toEqual(['requested', 'resolved']);
  });

  it('cancel(id) denies that request and reports it resolved', async () => {
    const events: string[] = [];
    const b = new PermissionBroker({ onChange: (e) => events.push(e.type) });
    const p = b.request('A', 'Bash', {});
    expect(b.cancel(b.pending()[0].id)).toBe(true);
    await expect(p).resolves.toMatchObject({ behavior: 'deny' });
    expect(b.pending()).toEqual([]);
    expect(events).toEqual(['requested', 'resolved']);
    expect(b.cancel('nope')).toBe(false);
  });
});
