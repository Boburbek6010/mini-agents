# Browser Agent Chat — Design

**Date:** 2026-10-12 · **Owner:** Boburbek · **Status:** draft for review

## Goal

Command agents from the office web page instead of Terminal windows. Click an agent, type a task, watch the reply stream in, approve risky actions with Allow/Deny — no Terminal needed.

## Decisions (agreed)

- **Approach A:** the office server runs the agents itself as headless `claude` processes.
- **Approvals:** in the browser (Allow / Deny), not auto-approved.
- **Login:** headless `claude -p` _without_ `--bare` uses the existing Claude Code login — no API key.
- **Agents:** Xurshidjon (`ITERA GREEN/move_green_mobile`), Watchdoger (`watchdog`), SMM (`ecotera-smm`).

## Non-goals (YAGNI)

No multi-user auth beyond the existing token. No scheduling. No file upload. No editing agent config from the UI (edit the JSON file).

## User experience

1. Start the office (launcher now only starts the server).
2. Bottom toolbar gets an **Agents** button → a roster of configured agents, each with a status dot (idle / working / needs approval).
3. Click an agent in the roster **or its character** → a chat drawer opens on the right: history, input box, **Send**, **Stop**, **New chat**.
4. Reply text streams in; tool use shows as one-line rows ("Read lib/main.dart", "Bash: flutter test").
5. When the agent needs permission, the drawer shows a card _"Run `flutter test`?"_ with **Allow** / **Deny**, and the character shows the existing permission bubble.
6. Characters animate exactly as today (the headless run writes the same transcript the watcher already follows).

## Architecture

```
Browser (React)                Office server (Fastify, Node)              claude CLI (per turn)
ChatDrawer ──ws: chatSend──▶  AgentChatManager ──spawn──▶  claude -p <text> --resume <sid>
          ◀─ws: chatEvent───   (stream-json parser)  ◀─stdout─  --output-format stream-json --verbose
          ◀─ws: permRequest─   PermissionBroker  ◀─HTTP─  office-permission MCP (stdio script)
          ──ws: permAnswer──▶                     ──HTTP─▶   ↳ answers --permission-prompt-tool
```

### Units

| Unit                                 | File                                                                            | Does                                                                                                                                                                                                                                                                                              | Depends on    |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Agent config                         | `office-agents.json` (repo root)                                                | `[{ "name", "cwd" }]`. Replaces `agent-names.json`; the folder-name resolver reads it too.                                                                                                                                                                                                        | —             |
| `agentConfig.ts`                     | `server/src/`                                                                   | Load + validate config, expand `~`.                                                                                                                                                                                                                                                               | fs            |
| `AgentChatManager`                   | `server/src/agentChat/manager.ts`                                               | One entry per configured agent: status, sessionId, history (last 200 items, in memory + `data/chat-sessions.json` for sessionId only). Spawns one `claude` process per turn, one turn at a time per agent; Stop = SIGINT.                                                                         | spawn, parser |
| `streamJsonParser.ts`                | `server/src/agentChat/`                                                         | Turns stream-json lines into `{text delta \| tool row \| result \| error}`. Pure → unit-testable.                                                                                                                                                                                                 | —             |
| `PermissionBroker`                   | `server/src/agentChat/permissions.ts`                                           | Holds pending requests `{id, agent, tool, input}`; resolves when the browser answers; auto-deny after 10 min.                                                                                                                                                                                     | —             |
| Permission MCP script                | `server/src/agentChat/permissionMcp.ts` → `dist/hooks/office-permission-mcp.js` | Tiny dependency-free stdio MCP server (initialize / tools/list / tools/call) exposing `approve`. On call it POSTs to `/api/permission` (token-authenticated, localhost only) and long-polls the decision, returning `{"behavior":"allow","updatedInput":…}` or `{"behavior":"deny","message":…}`. | http          |
| HTTP route                           | `httpServer.ts`                                                                 | `POST /api/permission` (blocks until answered).                                                                                                                                                                                                                                                   | broker        |
| WS messages                          | `core/asyncapi.yaml` → regenerated `messages.ts`                                | client→server: `agentChatSend`, `agentChatStop`, `agentChatReset`, `permissionAnswer`. server→client: `agentChatRoster`, `agentChatEvent`, `permissionRequest`, `permissionResolved`.                                                                                                             | —             |
| `ChatDrawer.tsx` + `AgentRoster.tsx` | `webview-ui/src/components/`                                                    | UI above.                                                                                                                                                                                                                                                                                         | transport     |

### Spawn command (per turn)

```
claude -p "<message>" [--resume <sessionId>]
  --output-format stream-json --verbose --include-partial-messages
  --permission-mode default
  --mcp-config '{"mcpServers":{"office":{"command":"node","args":["<dist>/hooks/office-permission-mcp.js"],"env":{"OFFICE_URL":"http://127.0.0.1:3100","OFFICE_TOKEN":"…","OFFICE_AGENT":"<name>"}}}}'
  --permission-prompt-tool mcp__office__approve
cwd = agent.cwd, env MCP_TOOL_TIMEOUT=600000
```

The first turn's `system/init` gives the `session_id`; later turns pass `--resume` so the agent remembers the conversation. **New chat** drops the sessionId.

### Data flow of one turn

1. Browser sends `agentChatSend{agent, text}` → manager rejects if that agent is busy (UI disables Send while busy).
2. Manager spawns `claude`, status → working, broadcasts `agentChatEvent` for each parsed line.
3. Permission needed → MCP script → `POST /api/permission` → broker → `permissionRequest` to browser → user clicks → `permissionAnswer` → HTTP response → claude continues.
4. `result` line → status idle, store sessionId, broadcast done.

## Error handling

- `claude` not on PATH / login expired → the `result`/stderr text is shown in the drawer as an error row; status back to idle.
- Process crash or non-zero exit → error row with the last stderr lines.
- Browser closed while a permission is pending → request stays pending (re-sent to the next client on `webviewReady`); auto-deny after 10 min.
- Server restart → in-memory history lost, sessionId kept, so the next message resumes the same conversation.

## Security

- `/api/permission` requires the per-run token and only listens on 127.0.0.1 (same as hooks).
- Default permission mode: nothing that edits files or runs commands happens without an Allow click.
- `office-agents.json` is local-only; no secrets in it.

## Testing

- Unit (Vitest): `streamJsonParser` on recorded stream-json fixtures; `PermissionBroker` resolve / timeout; `agentConfig` validation; MCP script JSON-RPC handshake against a fake server.
- Integration: manager with a fake `claude` script that emits canned stream-json (incl. a permission round-trip).
- Manual on the Mac: send "hi" to each agent; trigger a Bash command and Allow / Deny it; Stop mid-turn; New chat.

## Open risk

The exact JSON shape `--permission-prompt-tool` expects is verified first, with a 10-line probe, before building the UI.
