# Writing an adapter

An adapter translates one agent's native notifications into canonical events.
It is a pure function: **it stores nothing and decides nothing.** No thresholds,
no cooldown, no sentence building — the core owns all of that, so every agent
gets the same behavior and the same fixes.

## The contract

```
adapters/<agent>.sh <subcommand>     # native payload on stdin
```

**The file must be executable (`chmod +x`).** Without it, `bin/notify` logs
`no adapter at <path>` and does nothing — even though the file exists and its
contents are correct. This is the single most likely reason a new adapter does
nothing on the first try.

The adapter's own duty, independent of what it writes: **exit 0 for any
input** (garbage stdin, missing fields, an unknown subcommand — never crash
the hook that called you), and **emit either nothing or exactly one valid JSON
event**. `bin/notify` always exits 0 regardless, but a non-zero adapter exit is
still noise worth avoiding.

Write exactly one JSON event to stdout, or nothing:

```json
{ "type": "task_done",
  "agent": "your-agent",
  "session_id": "stable-identity",
  "session_name": "Human readable, optional",
  "project": "last path segment, optional",
  "text": "what was asked, or the message, optional" }
```

| `type` | When |
|---|---|
| `turn_start` | The user submitted a request. Carry the request in `text` |
| `task_done` | The agent finished responding |
| `background_done` | Background work finished (a subagent, a queued task) |
| `needs_input` | The agent is blocked on a permission or a question |

`session_id` must be stable for the life of a session — it is the state key.
Never emit a duration: the core computes it from the `turn_start` it stored.

`type`, `agent` and `session_id` are **REQUIRED**. If any one of the three is
missing or empty, the core silently drops the whole event and logs
`ignored: incomplete event` — nothing is spoken, and there is no other signal
that the event was lost. Double-check all three are non-empty before writing.

`text` on `task_done` is **discarded** — the core substitutes the text it
stored from that session's `turn_start` event instead (the `stop`-style hook
that fires `task_done` never carries the original request itself). Setting
`text` on a `task_done` event is silently ignored; do not rely on it.

The `agent` field should match the agent name passed on argv (and used in
`bin/notify <agent> <subcommand>` / the adapter's own filename). A mismatch is
tolerated — nothing errors — but it silently splits one agent's state into two
separate state directories (`av_state_path` keys on the `agent` field from the
event, not on argv), so turn markers and cooldowns stop lining up with each
other.

## Three ways to get triggered

Agents differ in what they offer. In descending order of reliability:

1. **Native hooks** — the agent runs a command on lifecycle events. Claude Code
   works this way; wire each hook to `bin/notify <agent> <subcommand>`.
2. **A wrapper** — you launch the agent through a script that calls `notify`
   before and after. Works for any CLI, costs you the original invocation.
3. **A log watcher** — a background process tails the agent's log and calls
   `notify` on matching lines. Last resort: fragile against format changes.

## Checklist

- [ ] `chmod +x adapters/<agent>.sh` — a non-executable adapter is invisible to `bin/notify`
- [ ] `adapters/<agent>.sh` emits valid JSON for every subcommand
- [ ] Unknown subcommands exit 0 without output
- [ ] A display name in `av_agent_name` (`lib/phrases.sh`) if the raw id reads badly aloud
- [ ] Cases added to `test/run.sh`, mirroring the `claude-code` block
- [ ] The trigger documented at the top of the adapter
