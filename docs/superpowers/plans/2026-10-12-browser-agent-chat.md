# Browser Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat with configured agents from the office web page (send, stream replies, Stop, New chat, Allow/Deny), with no Terminal windows.

**Architecture:** The standalone server spawns one headless `claude -p` process per turn per agent (resumed by session id) and parses its stream-json output into chat events broadcast over the existing WebSocket. Permission prompts go through `--permission-prompt-tool` → a tiny bundled stdio MCP script → `POST /api/permission` → `PermissionBroker` → browser card → answer.

**Tech Stack:** Node 20+, TypeScript, Fastify (existing), Vitest (server/webview), React 19 webview, AsyncAPI-generated `core/src/messages.ts`.

**Spec:** `docs/superpowers/specs/2026-10-12-browser-agent-chat-design.md`

## Global Constraints

- No new runtime dependencies (MCP script is hand-rolled JSON-RPC over stdio).
- Never pass `--bare` (it drops the subscription login).
- Spawn flags: `--output-format stream-json --verbose --include-partial-messages --permission-mode default --permission-prompt-tool mcp__office__approve --mcp-config <json>`; env `MCP_TOOL_TIMEOUT=600000`.
- Permission auto-deny after **10 min** (600000 ms). History cap **200** items per agent.
- All new client→server messages (`agentChatSend`, `agentChatStop`, `agentChatReset`, `permissionAnswer`) require `ctx.privileged` — they run commands on the Mac.
- `POST /api/permission` uses the existing `bearerAuth(token)` pre-handler.
- Config file: `office-agents.json` at repo root, `[{ "name": string, "cwd": string }]`, `~` expanded; it replaces `agent-names.json` (delete that file and `server/src/agentNames.ts`).
- Edit `core/asyncapi.yaml` and regenerate with `npm run asyncapi:generate`; never hand-edit `core/src/messages.ts`.

## Review Focus

1. Send while the agent is busy → server replies `agentChatEvent` with an error item "Agent is busy — wait or press Stop"; nothing is queued. (Task 5 test)
2. `claude` missing from PATH or login expired → an `error` item with the stderr/result text, status back to `idle`. (Task 5 test)
3. A client without the token sends `agentChatSend` / `permissionAnswer` → ignored, no process spawned. (Task 6 test)
4. Browser reloaded while a permission is pending → the pending `permissionRequest` is re-sent on `webviewReady`. (Task 6 test)
5. `cwd` containing spaces (`~/StudioProjects/ITERA GREEN/move_green_mobile`) → spawned with the right cwd, no shell quoting (use `spawn` with an args array, `shell: false`). (Task 5 test)

---

### Task 1: Probe the permission-prompt-tool contract (throwaway)

**Files:** scratch only, `/tmp/probe/` (not committed)

- [ ] **Step 1:** Write a 30-line stdio MCP script exposing tool `approve` that logs its `arguments` to `/tmp/probe/log.json` and returns `{"behavior":"allow","updatedInput":<arguments.input>}` as a single text content block.
- [ ] **Step 2:** In a temp dir run `claude -p "create a file hello.txt containing hi" --output-format stream-json --verbose --permission-prompt-tool mcp__office__approve --mcp-config '<json pointing at the script>'`.
- [ ] **Step 3:** Confirm: `hello.txt` exists; the log shows the argument keys (expected `tool_name`, `input`, `tool_use_id`); the stream contains `system/init` with `session_id`. Repeat with `{"behavior":"deny","message":"no"}` and confirm the file is NOT created.
- [ ] **Step 4:** Record the confirmed argument and result shapes at the top of `permissionMcp.ts` (Task 4) as a comment. If they differ from the expectation above, update Tasks 3–4 before continuing.

### Task 2: Agent config

**Files:**

- Create: `server/src/agentConfig.ts`, `office-agents.json`
- Modify: `server/src/cli.ts` (resolver wiring), delete `server/src/agentNames.ts`, `agent-names.json`
- Test: `server/__tests__/agentConfig.test.ts`

**Interfaces — Produces:**

- `interface OfficeAgent { name: string; cwd: string }` (cwd absolute after load)
- `loadOfficeAgents(file: string): OfficeAgent[]` — returns `[]` and logs on missing/invalid file; skips entries without both string fields; expands leading `~`.
- `resolveAgentName(ctx: { cwd?: string; projectDir?: string }, agents: OfficeAgent[]): string | undefined` — same matching rules as today's `agentNames.ts` (exact cwd, or projectDir basename equal to / ending with the cwd encoded as non-alphanumerics → `-`).

- [ ] **Step 1: Failing tests** — `loads and expands ~` (`[{name:'SMM',cwd:'~/x'}]` → cwd `os.homedir()+'/x'`); `skips invalid entries`; `missing file → []`; `resolves by projectDir with spaces` (`-Users-b-StudioProjects-ITERA-GREEN-move-green-mobile` → `Xurshidjon`); `unknown → undefined`.
- [ ] **Step 2:** `cd server && npx vitest run __tests__/agentConfig.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement; in `cli.ts` load `path.resolve(distDir,'..','office-agents.json')` once at startup and call `setFolderNameResolver(ctx => resolveAgentName(ctx, agents))`. Write `office-agents.json` with Xurshidjon / Watchdoger / SMM (cwds from the spec).
- [ ] **Step 4:** Tests PASS; `npm run check-types` clean.
- [ ] **Step 5:** Commit `feat: office-agents.json agent config`.

### Task 3: stream-json parser

**Files:** Create `server/src/agentChat/streamJsonParser.ts`; Test `server/__tests__/streamJsonParser.test.ts` with fixtures in `server/__tests__/fixtures/stream-json/*.jsonl` (captured from the Task 1 probe).

**Interfaces — Produces:**

```ts
export type ChatEvent =
  | { kind: 'init'; sessionId: string }
  | { kind: 'text'; text: string } // streamed delta
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'result'; isError: boolean; text: string; sessionId?: string }
  | { kind: 'error'; text: string };
export function parseStreamJsonLine(line: string): ChatEvent[];
export function summarizeTool(name: string, input: Record<string, unknown>): string;
```

Rules: text comes ONLY from `stream_event` `content_block_delta`/`text_delta` (assistant messages are ignored for text, to avoid duplicates); `tool` from `assistant` messages' `tool_use` blocks with `parent_tool_use_id === null`; unparseable line → `[]`. `summarizeTool`: Bash → `Bash: <command first 80 chars>`, Read/Edit/Write → `<Name> <file_path relative-looking tail>`, otherwise `<Name>`.

- [ ] **Step 1: Failing tests** — init line → `[{kind:'init',sessionId:'abc'}]`; two text deltas → two `text` events; assistant tool_use Bash `{command:'flutter test'}` → `{kind:'tool',name:'Bash',summary:'Bash: flutter test'}`; result success/error; garbage → `[]`; full fixture file → expected event sequence.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: stream-json parser for agent chat`.

### Task 4: Permission broker + MCP script + HTTP route

**Files:**

- Create: `server/src/agentChat/permissions.ts`, `server/src/agentChat/permissionMcp.ts`
- Modify: `esbuild.js` (`buildHooks` also bundles `permissionMcp.ts` → `dist/hooks/office-permission-mcp.js`, cjs + shebang), `server/src/httpServer.ts` (route), `HttpServerOptions` gains `permissions?: PermissionBroker`
- Test: `server/__tests__/permissions.test.ts`, `server/__tests__/permissionMcp.test.ts`

**Interfaces — Produces:**

```ts
export type PermissionDecision =
  { behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string };
export interface PendingPermission {
  id: string;
  agent: string;
  toolName: string;
  summary: string;
}
export class PermissionBroker {
  constructor(opts?: {
    timeoutMs?: number;
    onChange?: (
      e: { type: 'requested'; req: PendingPermission } | { type: 'resolved'; id: string },
    ) => void;
  });
  request(agent: string, toolName: string, input: unknown): Promise<PermissionDecision>;
  answer(id: string, allow: boolean): boolean; // false if unknown id
  pending(): PendingPermission[];
  cancelAgent(agent: string): void; // deny all pending for agent (used by Stop)
}
```

Route: `POST /api/permission` body `{agent, toolName, input}`, `bearerAuth`, awaits `broker.request(...)`, replies with the decision JSON. Deny message on timeout: `"No answer from the office within 10 minutes"`; on user deny: `"Denied in the office"`.
MCP script: reads env `OFFICE_URL`, `OFFICE_TOKEN`, `OFFICE_AGENT`; handles `initialize` (protocolVersion echo, `capabilities:{tools:{}}`), `notifications/initialized` (no reply), `tools/list` (one tool `approve`, inputSchema object with `tool_name`, `input`, `tool_use_id`), `tools/call` → POST → `{content:[{type:'text',text:JSON.stringify(decision)}]}`; HTTP failure → deny with the error text.

- [ ] **Step 1: Failing tests** — broker: `answer(allow)` resolves `{behavior:'allow',updatedInput:input}`; deny resolves deny; timeout (`timeoutMs: 20`) resolves deny with the timeout message; `pending()` lists then clears; `cancelAgent` denies only that agent's requests; `onChange` fires requested/resolved. MCP: spawn the bundled script with a fake HTTP server, send initialize + tools/list + tools/call over stdin, assert the three responses and that the fake server got `Authorization: Bearer <token>`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `node esbuild.js` then run tests → PASS.
- [ ] **Step 5:** Commit `feat: browser permission broker and office MCP approve tool`.

### Task 5: AgentChatManager

**Files:** Create `server/src/agentChat/manager.ts`; Test `server/__tests__/agentChatManager.test.ts` + `server/__tests__/fixtures/fake-claude.mjs` (prints a canned stream-json file chosen by env `FAKE_SCENARIO`, echoes its argv/cwd into the init line, exits with code from env).

**Interfaces — Consumes:** `OfficeAgent` (Task 2), `parseStreamJsonLine` (Task 3), `PermissionBroker.cancelAgent` (Task 4).
**Produces:**

```ts
export type AgentStatus = 'idle' | 'working' | 'approval';
export interface ChatItem {
  role: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  ts: number;
}
export type ChatServerMessage =
  | { type: 'agentChatEvent'; agent: string; item: ChatItem; append?: boolean }
  | { type: 'agentChatStatus'; agent: string; status: AgentStatus };
export class AgentChatManager {
  constructor(opts: {
    agents: OfficeAgent[];
    claudeBin: string;
    mcpScript: string;
    officeUrl: string;
    token: string;
    stateFile: string;
    broker: PermissionBroker;
    emit: (m: ChatServerMessage) => void;
  });
  roster(): { name: string; status: AgentStatus; history: ChatItem[] }[];
  send(agent: string, text: string): void; // emits error item on busy/unknown
  stop(agent: string): void; // SIGINT + broker.cancelAgent
  reset(agent: string): void; // drops sessionId + history (rejected while busy)
}
```

`claudeBin` = `process.env.OFFICE_CLAUDE_BIN ?? 'claude'`. sessionIds persist in `stateFile` (`<repo>/data/chat-sessions.json`, `{ [agent]: sessionId }`). Consecutive `text` events extend the last assistant item (`append: true`). Status `approval` is set by the server wiring (Task 6) while the broker has a pending request for that agent.

- [ ] **Step 1: Failing tests** — happy path emits user item, streamed assistant text (append), tool row, status working→idle, stores sessionId; second send passes `--resume <id>`; busy → error item "Agent is busy — wait or press Stop"; `claudeBin` not found → error item mentioning `claude` + idle; non-zero exit → error item with last stderr; cwd with spaces reaches the child (fake echoes cwd); `stop` sends SIGINT; `reset` clears and next spawn has no `--resume`; history capped at 200.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`child_process.spawn(claudeBin, args, { cwd, env, shell: false })`, line-buffer stdout). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: agent chat manager running headless claude`.

### Task 6: Protocol + server wiring

**Files:**

- Modify: `core/asyncapi.yaml` (+ regenerate `core/src/messages.ts`), `server/src/clientMessageHandler.ts` (4 cases + roster/pending on `webviewReady`), `ClientMessageContext` gains `chat?: AgentChatManager; permissions?: PermissionBroker`, `server/src/httpServer.ts` (pass them through), `server/src/cli.ts` (construct broker + manager, broadcast via `store.broadcast`, map broker changes to `permissionRequest`/`permissionResolved` and agent status `approval`)
- Test: `server/__tests__/agentChatWiring.test.ts`

**Messages (asyncapi):** server→client `agentChatRoster {agents:[{name,status,history}]}`, `agentChatEvent {agent,item,append?}`, `agentChatStatus {agent,status}`, `permissionRequest {id,agent,toolName,summary}`, `permissionResolved {id}`; client→server `agentChatSend {agent,text}`, `agentChatStop {agent}`, `agentChatReset {agent}`, `permissionAnswer {id,allow}`.

- [ ] **Step 1: Failing tests** — privileged `agentChatSend` calls `chat.send`; unprivileged is ignored (no call); `permissionAnswer` calls `permissions.answer`; `webviewReady` sends `agentChatRoster` and one `permissionRequest` per pending item.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Edit yaml → `npm run asyncapi:generate` → implement handlers + cli wiring. **Step 4:** Tests PASS; `npm run check-types && npm run lint` clean; full `npm run test:server` green.
- [ ] **Step 5:** Commit `feat: wire agent chat into protocol and standalone server`.

### Task 7: Webview — roster + chat drawer

**Files:**

- Create: `webview-ui/src/components/AgentRoster.tsx`, `webview-ui/src/components/ChatDrawer.tsx`, `webview-ui/src/hooks/useAgentChat.ts`
- Modify: `webview-ui/src/components/BottomToolbar.tsx` (Agents button), `webview-ui/src/App.tsx` (mount drawer; clicking a character whose `folderName` matches a roster name opens its drawer)
- Test: `webview-ui/test/agentChat.test.ts`

**Interfaces — Produces:** `useAgentChat(transport)` → `{ roster, open: string|null, setOpen, send(agent,text), stop(agent), reset(agent), answer(id,allow), pending: PendingPermission[] }`; reducer `applyChatMessage(state, msg)` exported for tests.

- [ ] **Step 1: Failing tests** (reducer) — roster load; event append extends last assistant item; non-append adds item; status update; permissionRequest adds, permissionResolved removes.
- [ ] **Step 2:** `cd webview-ui && npx vitest run test/agentChat.test.ts` → FAIL. **Step 3:** Implement reducer + components (drawer: header name + status dot, scrolling history, tool rows in muted mono, error rows red, permission cards with **Allow**/**Deny**, textarea + **Send** (Enter sends, Shift+Enter newline, disabled while working), **Stop**, **New chat**). Match existing pixel UI styling (`components/ui`). **Step 4:** Tests PASS; `npm run build:webview` clean.
- [ ] **Step 5:** Commit `feat: agent roster and chat drawer in office UI`.

### Task 8: Ship to the Mac + end-to-end check

**Files:** Modify `~/StudioProjects/Start Agents.command` (server only, no `claude` windows).

- [ ] **Step 1:** `npm run build` green; copy `dist/`, `office-agents.json`, sources to `~/StudioProjects/mini-agents`; `npm install --omit=dev --ignore-scripts` there.
- [ ] **Step 2:** Update launcher to start only the server.
- [ ] **Step 3:** With the user: restart server; in Chrome open Agents → Xurshidjon → send "say hi in one line" → reply streams, character animates.
- [ ] **Step 4:** Send "run `ls` in the project root" → Allow card appears → Allow → output shown; repeat → Deny → agent reports denial.
- [ ] **Step 5:** Stop mid-reply works; New chat clears; second message after server restart resumes the conversation.
