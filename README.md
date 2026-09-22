# agent-voice

Spoken notifications for coding agents. An agent finishes a long task or needs
your attention; an Echo Dot says so out loud.

Built so that adding an agent costs one stateless translator — see
[`adapters/CONTRACT.md`](adapters/CONTRACT.md).

## How it works

```
Claude hook ──> adapters/claude-code.sh ──> canonical event ──> lib/core.sh ──> outputs/alexa.sh
                      (translate)               (JSON)            (decide)         (speak)
```

Adapters know one agent and nothing else. The core knows the rules and nothing
about any agent.

## Install

```bash
./test/run.sh          # everything green?
```

Then point the agent's hooks at `bin/notify`. For Claude Code, in
`~/.claude/settings.json`:

| Hook | Command |
|---|---|
| `UserPromptSubmit` | `<repo>/bin/notify claude-code start` |
| `Stop` | `<repo>/bin/notify claude-code stop` |
| `SubagentStop` | `<repo>/bin/notify claude-code task` |
| `TaskCompleted` | `<repo>/bin/notify claude-code task` |
| `Notification` | `<repo>/bin/notify claude-code notification` |

## When it speaks

| Event | Rule |
|---|---|
| Turn finished | Only past `AV_MIN_SECONDS` (60s). Otherwise it would talk after every "ok" |
| Background work finished | At most once per `AV_COOLDOWN_SECONDS` (120s), so ten subagents are not ten announcements |
| Needs your input | Always — it is blocking on you |

## Configuration

Everything in `config.sh` reads from the environment first:

| Variable | Default | Meaning |
|---|---|---|
| `AV_MIN_SECONDS` | 60 | Duration threshold for a finished turn |
| `AV_COOLDOWN_SECONDS` | 120 | Minimum gap between background announcements |
| `AV_MAX_SPEECH_CHARS` | 90 | Cut for the quoted request |
| `AV_OUTPUTS` | `alexa` | Space-separated output names |
| `AV_SPEAK_CMD` | `~/softwares/home-assistant/falar.sh` | How the Alexa output speaks |
| `AV_STATE_DIR` | `~/.local/state/agent-voice` | State and log |

## Diagnosing

```bash
tail ~/.local/state/agent-voice/events.log
```

Every firing is there, including the silent ones and why they were silent.
Turn markers are deleted when the turn ends, so an empty state directory
between turns is normal and proves nothing.

## Rolling back

The Claude Code cutover kept everything it replaced, on purpose, until this
implementation is confirmed speaking on the real device:

- `~/.claude/settings.json.bak-agent-voice` — the hooks config from before the
  cutover. Restore it (copy back over `~/.claude/settings.json`) to point the
  five hooks at the old script again instead of `bin/notify`.
- `~/bin/claude-alexa-notify.sh.superseded` — the previous implementation
  itself, a single self-contained script. Kept in place, not deleted, so
  restoring the hooks config is enough on its own; nothing else needs
  reinstalling.

## Language

Code and docs are English. The spoken sentences are Portuguese and live only in
`lib/phrases.sh`.
