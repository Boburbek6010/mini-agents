/**
 * Office agent config: `office-agents.json` at the install root, e.g.
 *   [{ "name": "Xurshidjon", "cwd": "~/StudioProjects/ITERA GREEN/move_green_mobile" }]
 * Used both for the character display names and for the browser chat roster.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OfficeAgent {
  name: string;
  /** Absolute working directory (leading `~` expanded). */
  cwd: string;
}

const expandHome = (p: string): string => p.replace(/^~(?=$|\/)/, os.homedir());

/** Claude Code names a project's transcript dir after its cwd with every non-alphanumeric char → '-'. */
const encodeProjectDir = (p: string): string => p.replace(/[^a-zA-Z0-9]/g, '-');

export function loadOfficeAgents(file: string): OfficeAgent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[Pixel Agents] Ignoring unreadable ${file}: ${(err as Error).message}`);
    }
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const agents: OfficeAgent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, cwd } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !name || typeof cwd !== 'string' || !cwd) continue;
    agents.push({ name, cwd: path.resolve(expandHome(cwd)) });
  }
  return agents;
}

export function resolveAgentName(
  ctx: { cwd?: string; projectDir?: string },
  agents: OfficeAgent[],
): string | undefined {
  for (const agent of agents) {
    if (ctx.cwd && path.resolve(ctx.cwd) === agent.cwd) return agent.name;
    if (ctx.projectDir) {
      const dir = path.basename(ctx.projectDir);
      if (
        dir === encodeProjectDir(agent.cwd) ||
        dir.endsWith('-' + encodeProjectDir(path.basename(agent.cwd)))
      ) {
        return agent.name;
      }
    }
  }
  return undefined;
}
