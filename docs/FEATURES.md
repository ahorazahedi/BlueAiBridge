# Features compared with agent-review-bridge

BlueAIBridge is a new implementation of the ideas in [tolgaertunc/agent-review-bridge](https://github.com/tolgaertunc/agent-review-bridge): no code is shared. This table maps the original's features to how BlueAIBridge covers them, and lists what it adds.

## Parity

| agent-review-bridge | BlueAIBridge | Notes |
|---|---|---|
| One-off review (`bridge_review`) | `blue_review` | code or plan; paths; `include_diff`; reviewer by app, thread, session or join code |
| Plan review, waits for the user | ✔ | plan approval tells the agent to wait for you, unless auto mode started it on its own |
| `[APPROVED]` / `[CHANGES REQUESTED]`, strict | ✔ | `blue_advise` refuses ambiguous verdicts; prose verdicts are parsed and repaired |
| Fix loop with rounds (`round_of`) | ✔ | same reviewer; previous verdict carried; asking again after no answer keeps the round |
| Emergency stop after 20 rounds | ✔ | `maxRounds` setting |
| Auto mode at key moments + end-of-turn check | ✔ | fingerprint-based; stops a turn once per set of changes; baseline at start |
| Auto mode, every turn | ✔ | snapshots through a temporary index; turn queue capped at 10; reviewer's own turns skipped |
| Reminder after 5 prompts / whole-work review offer | ✔ | |
| Join codes, same-app pairing | ✔ | 6-character codes; waiting requests handed over inline |
| Free messages (`bridge_send`, `bridge_receive`) | `blue_send`, `blue_receive` | |
| `bridge_status`, `bridge_unlink` | `blue_status`, `blue_unlink` | |
| Read the other app's chats (`bridge_read_chat`) | `blue_read_chat` | Claude: active branch only (rewinds dropped); Codex: names from `session_index.jsonl`; reviewer chats protected |
| Model / effort choice checked against the app's list | ✔ | |
| User rules file | `~/.blueaibridge/rules.md` | also editable in the dashboard |
| `config.json` (`openClosedApps`, `autoReviews`, `readChatsInReviewers`) | ✔ | plus delivery, models, timeouts, retention, port |
| Open closed apps (ask / always) | ✔ | ChatGPT Desktop, or the exact Claude session |
| Waking ChatGPT (queue + wake link) | ✔ | |
| Waking Claude (`asyncRewake` listener) | ✔ | |
| Usage-limit check before sending | ✔ | the message waits until the limit resets |
| Following a queued ChatGPT turn up to 6 h | ✔ | rollout watcher; a prose verdict is accepted |
| `StopFailure` and permission-prompt notices | ✔ | |
| Secret files excluded | ✔ | by path, everywhere |
| Peer messages can't authorize anything | ✔ | |
| Installer with backups, uninstall | ✔ | per target; idempotent; your settings and hooks preserved (tested) |
| `doctor` incl. Codex hook trust | ✔ | also in the dashboard |
| Advisor mode (deprecated there) | — | replaced by every-turn auto mode in both |

## Added in BlueAIBridge

| Feature | |
|---|---|
| **Headless delivery** | `codex exec` / `claude -p` as a first-class channel: works with the apps closed, for the Codex CLI, and as a fallback |
| **`blue_ask`** | quick second opinions with session continuation |
| **Codex CLI support** | installs into the same config; CLI sessions get messages with their next prompt |
| **Claude Code CLI** | covered by the same user-scope install |
| **Native macOS app** | SwiftUI window with every page (Swift Charts, native tables, save panels), plus a menu-bar icon with live status |
| **Web dashboard** | the same UI for Windows and Linux (and any browser): conversations, traffic, live activity, chat library, install/uninstall, health, settings, CSV/JSON export |
| **Background service** | LaunchAgent (macOS), systemd user service (Linux), logon task (Windows) |
| **Windows & Linux** | installer support, PowerShell-safe Codex hooks on Windows |
| **SQLite + event log** | queryable history and metrics with retention |
| **Stable runtime** | configs point to `~/.blueaibridge/runtime/current`, so the source folder can move |
| **Retry with backoff** | transient errors retried longer; manual retry from the dashboard |
| **Prose verdict fallback** | a reviewer that answers in text instead of the tool still counts |
| **TypeScript** | typed end to end; 41 tests |

## Known limits

- Visible ChatGPT delivery relies on undocumented parts of ChatGPT Desktop (`codex app-server`'s experimental queue API and the wake link). An app update can break it; headless delivery keeps working.
- A Codex CLI session can't be woken from outside: messages reach it with its next prompt, or through `blue_receive`.
- Claude Desktop can't be asked to create a new chat, so from ChatGPT a new Claude reviewer is headless (`claude -p`) unless an open Claude chat joins with a code.
- Fingerprints and secret filtering go by file name and content hash. Secrets inside other files are not detected.
