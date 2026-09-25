# agent-voice in Node: a cross-platform CLI — design

Date: 2026-09-25
Status: approved in conversation, pending written-spec review

## Goal

Make agent-voice installable and manageable on **macOS, Windows and Linux**
with one command, and give it a management CLI so connecting agents and
speakers no longer means hand-editing JSON, `chmod +x`, and exporting env vars.

Success looks like: a person who has never seen the project runs
`npm i -g @lucaszaia/agent-voice && agent-voice setup`, answers a few
questions, hears a test sentence, and from then on their agent talks to them —
on any of the three operating systems.

## Decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| Interface | Management CLI with an interactive `setup` wizard | Serves both daily use and first install |
| Runtime | **Node ≥ 20, plain ESM JavaScript, zero runtime dependencies** | Portable; npm creates the right launcher per OS (`.cmd` shim on Windows). No build step |
| Existing bash code | **Replaced** by a behaviour-identical port | Two implementations would drift |
| Distribution | npm package `@lucaszaia/agent-voice`, command `agent-voice` | `agent-voice` is taken on npm by an unrelated project |
| Outputs | Catalog of built-in types configured with parameters | Newcomers do not have a `falar.sh`; the tool must speak on its own |
| Agents (v1) | `claude-code`, `codex`, and a generic `wrap` mode | Codex has lifecycle hooks with the same shape as Claude Code; `wrap` covers any other CLI |

## Architecture

The three-stage pipeline stays exactly as today — only the language changes:

```
agent hook ──> adapter.translate ──> core.handle ──> output.speak ──> device
               (pure)                (decides,       (makes noise)
                                      keeps state)
```

```
bin/agent-voice.js        dispatcher: notify | setup | connect | disconnect |
                          output | wrap | status | config | test
src/core/handle.js        port of lib/core.sh (av_handle, av_speak)
src/core/state.js         port of lib/state.sh (turn markers, cooldown)
src/core/phrases.js       port of lib/phrases.sh — the only pt-BR file
src/core/speech.js        port of lib/speech.sh (av_clean_speech)
src/core/log.js           port of lib/log.sh
src/core/hash.js          POSIX cksum CRC, so session colour labels and state
                          paths match the bash version byte for byte
src/config.js             defaults < config.json < environment (AV_*)
src/platform.js           per-OS directories and local-voice backend
src/adapters/<agent>.js   translate() + detect/connect/disconnect/status
src/outputs/<type>.js     speak() + questions() for the wizard + describe()
src/cli/<command>.js      one file per CLI command
test/*.test.js            node:test
```

Each unit has one job and can be tested alone: adapters never decide or store,
the core never knows an agent's payload format, outputs never see an event.

### Configuration and state locations

| OS | Config (`config.json`, `outputs/*.json`) | State + `events.log` |
|---|---|---|
| Linux | `$XDG_CONFIG_HOME/agent-voice` (default `~/.config/agent-voice`) | `$XDG_STATE_HOME/agent-voice` (default `~/.local/state/agent-voice`) |
| macOS | `~/Library/Application Support/agent-voice` | same directory, `state/` subfolder |
| Windows | `%APPDATA%\agent-voice` | `%LOCALAPPDATA%\agent-voice` |

`AV_STATE_DIR` and `AV_CONFIG_DIR` override both, which is how tests stay off
real directories. Linux paths equal today's, so existing state carries over.

`config.json`:

```json
{ "minSeconds": 30, "cooldownSeconds": 120, "maxSpeechChars": 90,
  "outputs": ["alexa-sala"] }
```

Precedence: built-in defaults < `config.json` < `AV_MIN_SECONDS`,
`AV_COOLDOWN_SECONDS`, `AV_MAX_SPEECH_CHARS`, `AV_OUTPUTS` from the
environment.

### Output instances

An output **type** is code (`src/outputs/<type>.js`). An output **instance** is
a file `outputs/<name>.json` in the config dir:

```json
{ "type": "alexa", "url": "http://localhost:8123", "token": "…",
  "entity": "notify.echo_dot_de_lucas_announce" }
```

Several instances of one type are allowed (`alexa-sala`, `alexa-escritorio`).
`config.outputs` lists which are active; each one active is spoken to, as
`AV_OUTPUTS` does today. Instance files holding secrets are written with mode
`0600` where the OS supports it.

Types in v1:

| Type | How it speaks | Wizard asks |
|---|---|---|
| `alexa` | `POST {url}/api/services/notify/send_message` with `{entity_id, message}`, bearer token, 20s timeout | URL, token (tested against `GET /api/`), then picks from `notify.*` entities listed by `GET /api/states` |
| `local` | macOS `say`; Windows PowerShell `System.Speech.Synthesis.SpeechSynthesizer`; Linux `spd-say`, else `espeak-ng`, else `espeak` | Voice — pt-BR preselected when the backend has one |
| `command` | Runs a command; `{text}` in its args is replaced by the sentence, otherwise the sentence goes on stdin. No shell — args are an array | The command line |

Every `speak()` resolves or throws an `Error` whose message is the reason; the
core logs `spoke via <name>` or `FAILED via <name> (<reason>)` exactly as today.

### Agent connections

Each adapter module exports, beside `translate(subcommand, payload)`:

- `detect()` → is this agent installed (its config dir exists)?
- `connect()` → merge our hooks into its config
- `disconnect()` → remove only our hooks
- `status()` → connected / not connected / partially connected, plus notes

Hook command form: `agent-voice notify <agent> <subcommand>`.

Merge rules, shared by both agents (`src/adapters/hooks-json.js`):

- Our entries are recognised by their command: `agent-voice notify <agent>` **or**
  a path ending in `bin/notify <agent>` (the old bash install), so connecting
  replaces the legacy hooks instead of doubling them.
- Idempotent: running `connect` twice leaves the file byte-identical.
- Hooks that are not ours are never touched, reordered or reformatted beyond
  JSON re-serialisation with 2-space indent.
- Before any write: a backup `<file>.bak-<YYYYMMDD-HHMMSS>`.
- File missing → created. File present but invalid JSON → abort, write nothing,
  say which file and why.
- `connect` shows the hooks it is about to add and asks for confirmation
  (skipped with `--yes`).

**Claude Code** — `~/.claude/settings.json` (all OSes; `%USERPROFILE%\.claude`
on Windows). Same hook set and subcommand mapping as today:

| Hook | Subcommand | Event |
|---|---|---|
| `UserPromptSubmit` | `start` | `turn_start` (text = `prompt`) |
| `Stop` | `stop` | `task_done` |
| `SubagentStop`, `TaskCompleted` | `task` | `background_done` (text = first of `agent_type`, `subagent_type`, `description`, `task_description`) |
| `Notification` | `notification` | `needs_input` (text = `message`) |

Session name: newest `{"type":"ai-title"}` line in `transcript_path`, read
from the end of the file; `_`/`-` become spaces. Project: last segment of
`cwd`, empty when `cwd` is the home dir. Async and timeout flags as in today's
README.

**Codex** — `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`).
`UserPromptSubmit` → `start`, `Stop` → `stop`. Session id from the payload's
session/thread id. If the installed Codex exposes a permission/approval hook
event, it is mapped to `needs_input`; which field names Codex actually sends is
**verified against a real Codex install during implementation** and pinned in
fixtures. If no such event exists, `status` states that Codex cannot announce
"needs you".

### `wrap`

```
agent-voice wrap [--name <label>] -- <command> [args…]
```

1. `session_id = wrap-<pid>`; emits `turn_start` with the command line as text
   (or `--name`).
2. Spawns the command with inherited stdio.
3. On exit — including after SIGINT/SIGTERM, which are forwarded to the child —
   emits `task_done` and exits with the child's exit code.

The core applies the same rules, so a short wrapped command stays silent.

### CLI commands

```
agent-voice setup                        wizard (below)
agent-voice connect <agent> [--yes]      claude-code | codex
agent-voice disconnect <agent>
agent-voice output add <type> [name]     asks the type's questions, then tests
agent-voice output list
agent-voice output remove <name>
agent-voice output test [name]
agent-voice output enable|disable <name>
agent-voice wrap -- <cmd…>
agent-voice status                       agents, outputs, effective config, last 10 log lines
agent-voice config get [key]
agent-voice config set <key> <value>
agent-voice test                         speak a sentence on every active output
agent-voice notify <agent> <sub>         hook entry point (not for humans)
```

Interactive prompts use `node:readline/promises`; no prompt library.

**`setup`**:

1. Detect installed agents; for each, show what `connect` would add and ask.
2. Ask for an output type, run its questions, save the instance, enable it.
3. Speak a test sentence and ask "ouviu?". No → show the error (if any) and go
   back to step 2.
4. Print a summary and point to `agent-voice status`.

Re-running `setup` shows the current state and lets the user change only part
of it.

### Error handling

- **`notify` never fails.** A top-level `try/catch` logs any error and the
  process exits 0 — for bad input, missing config, a dead speaker, an unknown
  agent. This is the property the bash version guarantees and the port must
  keep.
- Interactive commands print a clear one-line error and exit non-zero.
- `events.log` keeps today's line format, so existing `grep` recipes in the
  README keep working.

## Migration from the bash version

1. Install the npm package.
2. `agent-voice setup` → output type `command` with
   `~/softwares/home-assistant/falar.sh -a {text}` (or the native `alexa` type).
3. `agent-voice connect claude-code` replaces the `…/bin/notify` hooks.
4. Remove `bin/notify`, `lib/`, `adapters/*.sh`, `outputs/*.sh`, `config.sh`,
   `test/run.sh` from the repo in the same change that lands the port.

## Testing

`node --test`, no test dependencies.

- **Parity:** every case in `test/run.sh` ported to the core, state, phrases,
  speech and claude-code adapter tests. The same inputs produce the same
  spoken sentence and the same log line.
- **Hash parity:** `hash.js` checked against known `cksum` outputs.
- **Hook merge:** fixtures for empty file, missing file, invalid JSON, foreign
  hooks present, legacy bash hooks present, run twice (idempotent),
  disconnect leaving foreign hooks intact.
- **Outputs:** `alexa` against a local `http.createServer` fake; `command`
  against a stub script; `local` only for backend selection (no audio in CI).
- **`notify` exit code** is 0 for every failure scenario.
- **`wrap`** propagates exit codes and emits both events.
- **CI:** GitHub Actions matrix `ubuntu-latest`, `macos-latest`,
  `windows-latest` × Node 20 and 22.

## Out of scope for v1

- Homebrew/Scoop packages and standalone binaries.
- Agents other than Claude Code and Codex (beyond `wrap`).
- Languages other than pt-BR for the spoken sentences.
- A GUI or TUI.
