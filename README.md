# agent-voice

**Make your coding agent talk to you.** When Claude Code finishes a long task —
or gets stuck waiting for your permission — a smart speaker says so out loud:

> *"Claude Code terminou na sessão Home assistant repo, depois de cerca de 4
> minutos. Você tinha pedido: criar o docker compose."*

> *"Claude Code precisa de você na sessão agent-voice, para usar o Bash."*

---

## The idea

You ask an agent to do something that takes a while, and you stop watching. You
switch to another window, read something, take a call. Two things then go wrong:

1. **The work finishes and just sits there.** You come back five minutes later
   than you needed to, every time.
2. **Worse: it stopped early.** It hit a permission prompt thirty seconds in and
   has been waiting for you ever since, while you thought it was working.

A popup notification does not fix this, because it appears in the window you
already stopped looking at. Audio does — but only if it follows two rules:

- **Say something specific.** "Task complete" is useless when three sessions are
  running. It has to say *which* session, and *what you had asked for*.
- **Stay quiet most of the time.** A notifier that speaks after every reply gets
  muted on day one.

agent-voice is that: a small bash program that hooks into your agent, decides
whether an event is actually worth interrupting you for, builds a sentence in
plain language, and sends it to a speaker.

It ships with an adapter for **Claude Code** and an output for **Alexa** (via
Home Assistant), but both ends are pluggable — see *Using another agent* and
*Using another speaker* below.

---

## How it works

Three pieces, in a line:

```
your agent  ──>  adapter  ──>  core  ──>  output  ──>  speaker
                translate     decide      speak
```

| Piece | Job |
|---|---|
| **Adapter** (`adapters/claude-code.sh`) | Knows one agent. Turns its native hook payload into a standard JSON event. Decides nothing. |
| **Core** (`lib/core.sh`) | Knows no agent. Decides whether to speak, keeps per-session state, builds the sentence. |
| **Output** (`outputs/alexa.sh`) | Takes a finished sentence and makes a device say it. |

Everything enters through one command, `bin/notify`, which is what your hooks
call.

---

## Install

### 1. Get the code and check it runs

```bash
git clone https://github.com/LucasZaia/agent-voice.git
cd agent-voice
./test/run.sh
```

You should see `114 passed, 0 failed`. Requirements are `bash` and `jq`;
`perl` and `cksum` are used if present and skipped if not.

### 2. Tell it how to speak

`AV_SPEAK_CMD` is any command that accepts `-a "<sentence>"` and says it out
loud. The default points at a Home Assistant script, but anything works:

```bash
# quick way to try it with no smart speaker at all
export AV_SPEAK_CMD=/usr/bin/espeak-wrapper     # see "Using another speaker"
```

### 3. Check that a sentence actually comes out

```bash
echo "Teste do agent voice." | ./outputs/alexa.sh && echo "spoke"
```

If nothing is heard, fix this before wiring any hooks — everything downstream
assumes this step works.

### 4. Wire your agent's hooks

For Claude Code, add these to `~/.claude/settings.json`. Replace `<repo>` with
the absolute path to your clone:

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command",
      "command": "<repo>/bin/notify claude-code start", "timeout": 5}]}],
    "Stop": [{"hooks": [{"type": "command",
      "command": "<repo>/bin/notify claude-code stop", "async": true, "timeout": 20}]}],
    "SubagentStop": [{"hooks": [{"type": "command",
      "command": "<repo>/bin/notify claude-code task", "async": true, "timeout": 20}]}],
    "TaskCompleted": [{"hooks": [{"type": "command",
      "command": "<repo>/bin/notify claude-code task", "async": true, "timeout": 20}]}],
    "Notification": [{"hooks": [{"type": "command",
      "command": "<repo>/bin/notify claude-code notification", "async": true, "timeout": 20}]}]
  }
}
```

`UserPromptSubmit` is not optional: it is how the tool knows when your turn
started, and therefore how long it took. Without it nothing else can work.

If your `settings.json` already has hooks, merge rather than replace — and back
it up first.

### 5. Confirm it fired

Send any message to your agent, then:

```bash
tail ~/.local/state/agent-voice/events.log
```

A line like `claude-code  04c02385  turn started` means the hooks are live. If
nothing appears, your agent may still be running its old config — in Claude
Code, opening `/hooks` once reloads it.

---

## When it speaks

| Situation | What happens |
|---|---|
| A turn finishes in under 30s | Silent. Otherwise it would talk after every "ok" |
| A turn finishes in over 30s | **Speaks**, with how long it took and what you had asked |
| Background work finishes (a subagent, a queued task) | **Speaks**, at most once every 120s |
| Background work with nothing to report | Silent — a sentence with no content is noise |
| It needs your permission or input | **Always speaks**, even during a cooldown |

Every decision, including every silence, goes to the log with its reason:

```
16:05:23  claude-code  notif1  spoke via alexa: Claude Code precisa de você na sessão verde.
15:57:38  claude-code  a891ee  silent (turn 21s < 30s)
15:46:12  claude-code  04c023  silent (background_done with no content)
```

---

## Tuning it

The defaults are a starting point, not a recommendation. **Tune them against
your own log.** To see how long your turns actually run:

```bash
grep -oE 'silent \(turn [0-9]+s' ~/.local/state/agent-voice/events.log \
  | grep -oE '[0-9]+' | sort -n | tail -20
```

If most of your turns sit below the threshold, it will feel broken — it will
simply never speak. Mine started at 60s while my median turn was 21s, so it
silenced everything.

Override any variable in the environment, or edit `config.sh`:

| Variable | Default | What it does |
|---|---|---|
| `AV_MIN_SECONDS` | `30` | A turn shorter than this is not announced |
| `AV_COOLDOWN_SECONDS` | `120` | Minimum gap between background announcements |
| `AV_MAX_SPEECH_CHARS` | `90` | How much of your request is quoted back |
| `AV_SPEAK_CMD` | `~/softwares/home-assistant/falar.sh` | The command that speaks |
| `AV_OUTPUTS` | `alexa` | Which `outputs/<name>.sh` to send to |
| `AV_STATE_DIR` | `~/.local/state/agent-voice` | Where state and the log live |

---

## Using another speaker

An output is a script that reads a sentence on stdin and makes noise. To use
`espeak` instead of Alexa, create `outputs/espeak.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
sentence="$(cat)"
[ -n "$sentence" ] || exit 1
espeak -v pt-br "$sentence" >/dev/null 2>&1
```

Then `chmod +x outputs/espeak.sh` and set `AV_OUTPUTS=espeak`. Listing more
than one name sends to all of them: `AV_OUTPUTS="alexa espeak"`.

---

## Using another agent

Adding a second agent — Codex, Aider, your own script — means writing one
adapter and nothing else. The adapter reads that agent's native output and
prints one JSON event:

```json
{ "type": "task_done",
  "agent": "codex",
  "session_id": "stable-id-for-this-session",
  "session_name": "Optional human-readable name",
  "project": "optional-directory-name",
  "text": "what was asked, or the message" }
```

The four event types are `turn_start`, `task_done`, `background_done` and
`needs_input`. Your adapter never decides whether to speak, never stores
anything, and never builds a sentence — the core does all of that, so every
agent gets the same behaviour and the same fixes.

Full instructions, including how to trigger an agent that has no hooks:
[`adapters/CONTRACT.md`](adapters/CONTRACT.md).

---

## Troubleshooting

**It never speaks.** Check the log first — the reason is always there.

- `silent (turn 21s < 30s)` → working as configured; lower `AV_MIN_SECONDS`.
- `FAILED via alexa (...)` → the speaker command failed; the parenthesis holds
  its error. Test it in isolation with step 3 above.
- `no adapter at <path>` → the adapter file is missing, or not executable
  (`chmod +x`).
- `ignored: incomplete event` → the adapter produced an event without `type`,
  `agent` or `session_id`.
- Nothing at all → the hooks are not firing. Reload your agent's config.

**It speaks too much.** Raise `AV_MIN_SECONDS`, or raise
`AV_COOLDOWN_SECONDS` to space out background announcements.

**The state directory looks empty.** That is normal between turns — markers are
created when a turn starts and deleted when it ends. The log is the source of
truth, not the directory.

---

## Notes

- **Nothing here can break your agent.** Every entry point exits 0 no matter
  what — bad input, missing files, a dead speaker. A hook that hangs or errors
  is worse than no hook at all, so failures go to the log and nowhere else.
- **Language.** The code and docs are English; the spoken sentences are
  Brazilian Portuguese and live in one file, `lib/phrases.sh`. Translating means
  editing that file only.
- **Concurrency.** State is keyed per agent *and* per session, so several
  sessions running at once never mix up their turns, durations or cooldowns.

## License

MIT.
