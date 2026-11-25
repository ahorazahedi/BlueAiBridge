# Architecture

```text
 Claude Code chat                                       ChatGPT / Codex chat
 ┌──────────────┐  stdio JSON-RPC  ┌──────────────┐    ┌──────────────┐
 │ MCP client   │◀────────────────▶│ blueai mcp   │    │ blueai mcp   │◀──── stdio ────┐
 │ hooks ───────┼──┐               │ --side claude│    │ --side codex │                │
 └──────────────┘  │               └──────┬───────┘    └──────┬───────┘          ┌─────┴────────┐
                   │ files (outbox,       │ HTTP + token       │                  │ hooks ───────┤
                   │ inbox, view.json)    ▼                    ▼                  └──────────────┘
                   │              ┌─────────────────────────────────────┐                │
                   └─────────────▶│  broker (127.0.0.1:7600)            │◀───────────────┘
                                  │  Bridge engine · SQLite (WAL)       │   files
                                  │  RPC · dashboard API · SSE · static │
                                  └───────┬───────────────┬─────────────┘
                     visible: inbox file  │               │ visible: codex app-server
                     → Claude listener    │               │ thread/queue/add + codex://threads/wake
                     headless: claude -p  │               │ headless: codex exec [resume]
                                          ▼               ▼
                          Native macOS app (SwiftUI)   Web dashboard (React; Windows/Linux)
```

## Processes

| Process | Started by | Job |
|---|---|---|
| **broker** (`blueai broker`) | the background service (LaunchAgent / systemd user unit / logon task), or on demand by the first MCP server or hook | Single source of truth: SQLite state, delivery loop, HTTP API, live events, dashboard |
| **MCP server** (`blueai mcp --side …`) | each Claude session / Codex thread | Tools. Learns the caller's identity from the host (never from the model) and forwards to the broker |
| **hooks** (`blueai hook …`) | the apps, on each event | File-based only, with no network, because Codex may sandbox hooks |
| **headless runs** | the broker | `codex exec --json` / `claude -p --output-format json`, read-only, without the bridge loaded |

Only one broker runs per user: it binds the port, and a second one exits. An on-demand broker hands over to the LaunchAgent once that is installed.

## Identity

- Claude: `CLAUDE_CODE_SESSION_ID` (and `CLAUDE_CODE_HOST_SESSION_ID`, which reopens the session in Claude Desktop through `claude://code/continue`).
- Codex: `_meta.threadId` on every tool call. The rollout's `originator` tells Desktop (`codex_work_desktop`), CLI and `codex_exec` apart.

Compaction can't break a link: identity never depends on what the model remembers.

## State (SQLite, `~/.blueaibridge/data/bridge.db`)

| Table | Holds |
|---|---|
| `clients` | every chat seen: app, id, surface (desktop/cli/headless), folder, Desktop host id, listener heartbeat |
| `links` | a conversation: kind (review/auto/turn/ask), review kind, status, requester, reviewer, join code, delivery, round, paths, fingerprints at request time |
| `messages` | request, answer, ask, reply, message, notice; state machine `pending → sending → delivered → answered`, or `deferred`/`failed`/`cancelled`; channel; bytes; attempts; timing |
| `autos` | auto mode per chat: reviewer, paths, approved fingerprints, guard state, fix round |
| `turns` | every-turn mode: queued turns with start and end snapshots |
| `events` | append-only event log: drives the dashboard's live stream, activity feed and metrics |

## Delivery

`routeOf(message)` picks one of these:

- **note**: shown with the chat's next prompt (the prompt hook reads the chat's inbox file and acknowledges). Used for quiet notices, every-turn approvals and Codex CLI sessions, which can't be woken.
- **visible-claude**: written to `data/inbox/<chat>.json` as a *wake*. The Claude listener hook (`asyncRewake`) polls its inbox, writes the text to stderr, exits 2 (which wakes the session) and acknowledges through the outbox. If the session isn't listening, the message waits and is delivered when a listener or SessionStart hook shows up. With permission, the bridge opens the session.
- **visible-codex**: checks that ChatGPT is running and that its usage limit allows it. Then `thread/queue/add` on a private, short-lived `codex app-server` and `codex://threads/wake/<id>`. The broker then follows the turn in the thread's rollout file: a verdict written as prose is accepted, a turn that ends without an answer or fails is reported, and after 6 hours the request is given up.
- **headless**: `codex exec [resume <id>]` / `claude -p [--resume <id>]`. The final answer becomes the reply, or, for a review request, the parsed verdict.

Failures retry with exponential backoff: 3 attempts, or more for transient errors such as usage limits, overloads and timeouts. Then the message fails and the sender gets a notice that says how to ask again.

## Reviews and auto mode

- A request carries the agent's text plus, for each path, a status, a stat and read-only git commands that leave secrets out. The reviewer reads the changes itself. The size cap drops pasted diffs first, then shortens stats, then refuses.
- `fingerprint(path)` hashes the visible files (git-visible ones, or a walk outside git), secrets excluded. Committing doesn't change it. An approval in auto mode records the fingerprints taken *when the review was asked for*, so a change made while the review ran stays unapproved.
- In key-moments mode, the Stop hook compares the fingerprints with the approved ones and stops the turn once per set of unapproved changes.
- In every-turn mode, the prompt and Stop hooks snapshot each path as a git tree through a temporary index (the user's index and refs are untouched). The broker builds the turn's review from the user's message, the final answer and `git diff <start-tree> <end-tree>`. One turn review is out per chat at a time; at most 10 wait in the queue.
- A turn in which a chat answered a review isn't reviewed itself, so two chats reviewing each other don't loop.

## Hooks

| Hook | Claude | Codex | Does |
|---|---|---|---|
| UserPromptSubmit | ✔ | ✔ | notes from the inbox, auto mode's short rules, reminder after 5 prompts without a review, the user's rules; every-turn snapshot |
| SessionStart | ✔ (+ listener) | ✔ | auto mode's full rules, reviews waiting for this chat's answer, notes |
| Stop | ✔ (+ listener) | ✔ | turn end (every-turn reviews, prose verdict fallback); key-moment guard |
| StopFailure | ✔ | — | an API error ended a turn: whoever waits is told |
| Notification (permission_prompt) | ✔ | — | a reviewer waits for your tool approval: the requester is told |

## HTTP API (broker)

Every route except `/api/health` and `/auth` needs a `Bearer` token or the session cookie.

`POST /rpc` (tools) · `GET /api/summary|series|links|links/:id|messages|messages/:id|events|stream|clients|autos|config|rules|limits|install|doctor|chats|chats/:app/:id|export` · `PUT /api/config|rules` · `POST /api/links/:id/close`, `/api/messages/:id/retry`, `/api/autos/:key/off`, `/api/install`, `/api/maintenance/prune|tick`.

## Source layout

```text
src/
  cli.ts                 blueai command
  shared/                types, paths, config & rules, platform lookups, secrets, utilities
  core/                  store (SQLite), git, decision parsing/validation, prompt texts
  broker/                bridge engine, HTTP server, client
  delivery/              codex app-server driver, rollout watcher, headless runners
  mcp/                   MCP server and tool definitions
  hooks/                 hook entry point
  chats/                 Claude transcript + Codex rollout readers
  install/               installer, doctor
dashboard/               React + Vite web dashboard
macos/Sources/           native macOS app (SwiftUI, Swift Charts): window + menu-bar icon
macos/tools/             app icon renderer
macos/build.sh           builds macos/build/BlueAIBridge.app
test/                    node:test suites
scripts/demo.mjs         seeded demo broker
```
