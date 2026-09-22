# agent-voice — spoken notifications for coding agents

**Date:** 2026-09-22
**Status:** approved, pending implementation plan

## Problem

Today a single script, `~/bin/claude-alexa-notify.sh` (187 lines), does everything
at once: it reads Claude Code's native hook format, keeps per-session state, decides
whether an announcement is worth making, builds the sentence, and calls Home
Assistant.

It works, but the decision rules (duration threshold, cooldown, text cleanup for
speech) are welded to Claude Code's input format. Plugging in a second agent — Codex,
say — would mean copying the script and adjusting it, and from that point the rules
drift: one gets a punctuation fix the other never sees.

## Goal

A repository where plugging in a new agent costs **one translator**, and nothing else.

### Non-goals

Deliberately out of scope:

- **A Codex adapter.** Codex is not installed on this machine. The socket is ready
  and documented; the code is not. Writing a translator for a format nobody has
  observed is guesswork.
- **Output channels beyond Alexa** (Windows toast, Slack). The core dispatches to a
  list of outputs, but only `alexa` exists.
- **Absorbing the daily-priorities cron** (`~/bin/prioridades-diarias.sh`). It works
  and has three channels of its own. Migrating it is separate work with its own risk.

## Language

Identifiers, comments and documentation are in English.

**Spoken sentences are in Portuguese.** They are the product, not the code — the
person listening is a Brazilian Portuguese speaker, and Alexa is configured for
pt-BR. Phrase templates therefore live in one place (`lib/phrases.sh`) so the
language boundary is explicit rather than scattered through the core.

## Architecture

```
Claude hook ──┐
              ├──> adapters/<agent>.sh ──> canonical event ──> lib/core.sh ──> outputs/alexa.sh
Codex log ────┘         (translate)            (JSON)            (decide)        (speak)
```

The boundary is the **canonical event**. Above it, every agent is alien and
unpredictable. Below it, everything is the same.

### File layout

```
agent-voice/
  bin/notify                  single entry point
  lib/core.sh                 filters, builds the sentence, dispatches
  lib/state.sh                per-session state (turn start, cooldown, context)
  lib/phrases.sh              Portuguese sentence templates
  lib/speech.sh               text cleanup for speech
  lib/log.sh                  durable record of every firing
  adapters/claude-code.sh     translates Claude Code hooks
  adapters/CONTRACT.md        how to write a new adapter
  outputs/alexa.sh            calls falar.sh from the home-assistant repo
  test/run.sh                 regression tests, stubbed output
  config.sh                   thresholds and paths
```

### The canonical event

Emitted by the adapter on stdout, consumed by the core on stdin.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | enum | yes | `turn_start`, `task_done`, `background_done`, `needs_input` |
| `agent` | string | yes | `claude-code`, `codex`, … |
| `session_id` | string | yes | Stable identity; becomes the on-disk state key |
| `session_name` | string | no | Human-readable name for speech. Without it the core derives a label from the id |
| `project` | string | no | Working directory, last segment only |
| `text` | string | no | What was asked, or the agent's message |

The event carries **no duration**. An adapter does not know how long a turn took,
and asking it to would mean giving it access to state. The core computes it against
the `turn_start` it stored.

Example:

```json
{ "type": "task_done",
  "agent": "claude-code",
  "session_id": "04c02385-aa50-4bd0-9a13-fc326e1f3f24",
  "session_name": "Home assistant repo",
  "project": "home-assistant",
  "text": "conectar a alexa aos hooks de sessao" }
```

## Components

### `bin/notify`

```
notify <agent> <subcommand> [args]     # native JSON on stdin
```

Resolves `adapters/<agent>.sh`, passes stdin through, hands the resulting event to
the core. If the adapter is missing or emits nothing, it logs and exits 0 — it never
takes down its caller.

Depends on: adapters, `lib/core.sh`.

### `adapters/<agent>.sh`

Takes a subcommand and the native payload. Emits one canonical event on stdout.
**Decides nothing and stores nothing** — not whether to speak, not what to say, not
what happened on the previous turn.

An adapter is a pure function from native payload to event. That is what makes a new
agent cheap: no state to understand, no rule to replicate. Agent-specific knowledge
lives here — for Claude Code, finding `session_name` by reading `aiTitle` from the
transcript.

Depends on: nothing beyond `jq`.

### `lib/core.sh`

Where every decision rule lives.

First the core completes the event: on `turn_start` it stores the timestamp and
`text` and returns without speaking; on `task_done` it recovers both and computes the
duration. The adapter only handed over what it knew. Then:

1. **Filter by type.** `task_done` below the duration threshold → silence.
   `background_done` inside the cooldown → silence. `needs_input` is never filtered.
2. **Build the sentence** from the template for that type.
3. **Dispatch** to each output.

Every silent decision is logged with its reason. A hook that stays quiet and a hook
that died are indistinguishable otherwise — that was a real diagnostic mistake while
developing the current script.

### `lib/state.sh`

Used **by the core only**. State lives in
`~/.local/state/agent-voice/<agent>/<session_id>.*`, keyed by session, so concurrent
sessions never clobber each other. Turn markers are ephemeral: created on
`turn_start`, removed on `task_done`.

### `lib/phrases.sh`

The Portuguese sentence templates, one per event type. Isolated so that changing
what Alexa says — or adding another language later — touches one file.

### `lib/log.sh`

One line per firing in `~/.local/state/agent-voice/events.log`: timestamp, agent,
session, and what happened — spoke, stayed silent and why, or failed.

### `outputs/alexa.sh`

Takes the finished sentence on stdin. Calls `~/softwares/home-assistant/falar.sh -a`.

`falar.sh` **stays in the home-assistant repo**: it is the Home Assistant interface,
and the priorities cron already depends on it. Duplicating it here would create two
truths about how to speak through the Echo.

## Decision rules

| Rule | Value | Why |
|---|---|---|
| Duration threshold | 60s | Without it Alexa speaks after every reply, including a two-second "ok" |
| Background cooldown | 120s | An orchestration with 10 subagents would become 10 announcements |
| Cooldown stamped by | any utterance | Avoids speaking twice in a row about the same thing |
| Cooldown applies to | `background_done` only | `task_done` and `needs_input` always speak |

Configurable in `config.sh`.

## Failure behavior

The principle: **a hook that hangs is worse than a hook that does not exist.**

- `bin/notify` exits 0 in every scenario.
- Output unavailable (Home Assistant container stopped) → log `FAILED` and continue.
- Invalid or empty payload → log and exit.
- Missing adapter → log and exit.

## Tests

`test/run.sh` runs table-driven cases with the output stubbed, comparing the
generated sentence against the expected one. The cases come from what has already
been verified by hand:

| Case | Expected |
|---|---|
| 20s turn | silence, with a reason in the log |
| 240s turn | speaks, with duration and the request |
| Burst of 4 background events | 1 utterance, 3 in cooldown |
| `needs_input` during cooldown | speaks anyway |
| No `session_name` | falls back to the derived label |
| No `project` | sentence omits the project |
| Text with markdown, URL and `_` | cleaned for speech |
| Two concurrent sessions | separate state, separate sentences |

## Migration

In order, each step verifiable before the next:

1. Build the repo with the Claude Code adapter and passing tests.
2. Verify parity: sentences from the new repo match the current script's.
3. Point `~/.claude/settings.json` at `bin/notify claude-code <event>`.
4. Confirm real firings in the log.
5. Only then remove `~/bin/claude-alexa-notify.sh`.

## Rejected alternatives

**Generic core with per-agent YAML config.** Elegant on paper: a declarative file
says where the event comes from and how to extract each field. It needs a parsing
engine that can handle formats nobody has seen yet. With one known agent and one
hypothetical, that is abstraction bought too early.

**One complete script per agent, sharing only `falar.sh`.** The current state,
stretched. Cheap now, and precisely what produces divergent rules later.

**A single repo absorbing Home Assistant.** Ties the notification layer to Home
Assistant's infrastructure. The day an output is Slack, the repo has the wrong name.
