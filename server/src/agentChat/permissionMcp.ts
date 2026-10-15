/**
 * Office permission MCP server (stdio, dependency-free). Claude Code calls it
 * via `--permission-prompt-tool mcp__office__approve` whenever a tool needs
 * approval; it forwards the request to the office server and waits for the
 * user's Allow / Deny in the browser.
 *
 * Contract (verified against claude 2.1.296):
 *   tools/call arguments: { tool_name: string, input: object, tool_use_id: string }
 *   result: one text content block whose text is JSON
 *     { "behavior": "allow", "updatedInput": <input> } | { "behavior": "deny", "message": string }
 *
 * Env: OFFICE_URL (http://127.0.0.1:3100), OFFICE_TOKEN, OFFICE_AGENT.
 */
import * as http from 'http';
import * as readline from 'readline';

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

const OFFICE_URL = process.env.OFFICE_URL ?? 'http://127.0.0.1:3100';
const OFFICE_TOKEN = process.env.OFFICE_TOKEN ?? '';
const OFFICE_AGENT = process.env.OFFICE_AGENT ?? 'agent';

const APPROVE_TOOL = {
  name: 'approve',
  description: 'Ask the office user to allow or deny a tool call.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

const write = (msg: unknown): void => {
  process.stdout.write(JSON.stringify(msg) + '\n');
};

function askOffice(toolName: string, input: unknown): Promise<unknown> {
  const body = JSON.stringify({ agent: OFFICE_AGENT, toolName, input });
  const url = new URL('/api/permission', OFFICE_URL);
  return new Promise((resolve) => {
    const deny = (why: string) =>
      resolve({ behavior: 'deny', message: `Office unreachable: ${why}` });
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${OFFICE_TOKEN}`,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => (raw += c.toString()));
        res.on('end', () => {
          if (res.statusCode !== 200) return deny(`HTTP ${res.statusCode}`);
          try {
            resolve(JSON.parse(raw));
          } catch {
            deny('bad response');
          }
        });
      },
    );
    req.on('error', (err) => deny(err.message));
    req.end(body);
  });
}

async function handle(msg: RpcMessage): Promise<void> {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'office', version: '1.0.0' },
        },
      });
      return;
    case 'tools/list':
      write({ jsonrpc: '2.0', id, result: { tools: [APPROVE_TOOL] } });
      return;
    case 'tools/call': {
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const decision = await askOffice(String(args.tool_name ?? ''), args.input ?? {});
      write({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(decision) }] },
      });
      return;
    }
    default:
      // Notifications have no id and get no reply; unknown requests get an empty result.
      if (id !== undefined) write({ jsonrpc: '2.0', id, result: {} });
  }
}

// claude closed our stdin: it is gone, so stop waiting on any open approval request.
process.stdin.on('end', () => process.exit(0));

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg: RpcMessage;
  try {
    msg = JSON.parse(line) as RpcMessage;
  } catch {
    return;
  }
  void handle(msg);
});
