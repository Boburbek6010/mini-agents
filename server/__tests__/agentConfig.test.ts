import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadOfficeAgents, resolveAgentName } from '../src/agentConfig.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcfg-'));
const write = (name: string, data: unknown): string => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
  return p;
};
afterEach(() => undefined);

describe('loadOfficeAgents', () => {
  it('loads and expands ~', () => {
    const agents = loadOfficeAgents(write('a.json', [{ name: 'SMM', cwd: '~/x' }]));
    expect(agents).toEqual([{ name: 'SMM', cwd: path.join(os.homedir(), 'x') }]);
  });

  it('skips invalid entries', () => {
    const agents = loadOfficeAgents(
      write('b.json', [{ name: 'A', cwd: '/a' }, { name: 'B' }, { cwd: '/c' }, 'x', null]),
    );
    expect(agents).toEqual([{ name: 'A', cwd: '/a' }]);
  });

  it('missing file → []', () => {
    expect(loadOfficeAgents(path.join(tmp, 'nope.json'))).toEqual([]);
  });

  it('invalid JSON → []', () => {
    expect(loadOfficeAgents(write('c.json', '{not json'))).toEqual([]);
  });
});

describe('resolveAgentName', () => {
  const agents = [
    { name: 'Xurshidjon', cwd: '/Users/b/StudioProjects/ITERA GREEN/move_green_mobile' },
    { name: 'Watchdoger', cwd: '/Users/b/StudioProjects/watchdog' },
  ];

  it('resolves by projectDir with spaces', () => {
    expect(
      resolveAgentName(
        { projectDir: '/h/.claude/projects/-Users-b-StudioProjects-ITERA-GREEN-move-green-mobile' },
        agents,
      ),
    ).toBe('Xurshidjon');
  });

  it('resolves by exact cwd', () => {
    expect(resolveAgentName({ cwd: '/Users/b/StudioProjects/watchdog' }, agents)).toBe(
      'Watchdoger',
    );
  });

  it('unknown → undefined', () => {
    expect(resolveAgentName({ cwd: '/elsewhere' }, agents)).toBeUndefined();
  });
});
