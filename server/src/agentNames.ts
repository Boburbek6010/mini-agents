/**
 * Custom display names for agents, keyed by project folder.
 *
 * Reads `agent-names.json` next to the install (one level above dist/),
 * e.g. { "~/StudioProjects/watchdog": "Watchdoger" }. Re-read on every call
 * so edits apply to the next detected agent without a rebuild.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const NAMES_FILE = path.resolve(path.dirname(process.argv[1] ?? '.'), '..', 'agent-names.json');

/** Claude Code stores transcripts under a dir named after the cwd with every non-alphanumeric char → '-'. */
const encode = (p: string): string => p.replace(/[^a-zA-Z0-9]/g, '-');

function loadNames(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function resolveAgentName(ctx: { cwd?: string; projectDir?: string }): string | undefined {
  for (const [folder, name] of Object.entries(loadNames())) {
    if (typeof name !== 'string' || !name) continue;
    const abs = path.resolve(folder.replace(/^~(?=$|\/)/, os.homedir()));
    if (ctx.cwd && path.resolve(ctx.cwd) === abs) return name;
    if (ctx.projectDir) {
      const dir = path.basename(ctx.projectDir);
      if (dir === encode(abs) || dir.endsWith('-' + encode(path.basename(abs)))) return name;
    }
  }
  return undefined;
}
