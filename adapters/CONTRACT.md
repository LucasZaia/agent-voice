# Writing an adapter

An adapter translates one agent's native notifications into canonical events.
It is a pure function: **it stores nothing and decides nothing.** No thresholds,
no cooldown, no sentence building — the core owns all of that, so every agent
gets the same behavior and the same fixes.

## The contract

```
adapters/<agent>.sh <subcommand>     # native payload on stdin
```

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

## Three ways to get triggered

Agents differ in what they offer. In descending order of reliability:

1. **Native hooks** — the agent runs a command on lifecycle events. Claude Code
   works this way; wire each hook to `bin/notify <agent> <subcommand>`.
2. **A wrapper** — you launch the agent through a script that calls `notify`
   before and after. Works for any CLI, costs you the original invocation.
3. **A log watcher** — a background process tails the agent's log and calls
   `notify` on matching lines. Last resort: fragile against format changes.

## Checklist

- [ ] `adapters/<agent>.sh` emits valid JSON for every subcommand
- [ ] Unknown subcommands exit 0 without output
- [ ] A display name in `av_agent_name` (`lib/phrases.sh`) if the raw id reads badly aloud
- [ ] Cases added to `test/run.sh`, mirroring the `claude-code` block
- [ ] The trigger documented at the top of the adapter
