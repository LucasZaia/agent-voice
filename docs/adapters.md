# Writing an adapter

An adapter teaches agent-voice about one agent. It is a module in
`src/adapters/<agent>.js`, registered in `src/adapters/index.js`. It **stores
nothing and decides nothing** — no thresholds, no cooldown, no sentences. The
core owns all of that, so every agent gets the same behaviour and the same fixes.

## The module

| Export | What it is |
|---|---|
| `name` | The agent id, e.g. `"codex"`. Used in hook commands, state paths and the log |
| `hooks` | `[{ event, sub, async?, timeout }]` — which agent events call `agent-voice notify <name> <sub>`. Give hooks that can speak `timeout: 60`: each output gets up to 15s, one after another, and the FAILED line must reach the log before the agent kills the hook |
| `notes` | Strings printed after `connect` (e.g. "trust the hooks in /hooks") |
| `configFile(env, home)` | Path of the agent's JSON config that holds hooks |
| `detect(env, home)` | Whether the agent is installed here |
| `hookReply(sub)` | What to print on stdout for the agent (usually `''`) |
| `translate(sub, payload, home)` | The agent's hook payload → one canonical event, or `null` |

`connect`/`disconnect` work for any agent whose config uses the
`{"hooks": {Event: [{hooks: [{type, command}]}]}}` shape; see
`src/adapters/hooks-json.js`.

## The canonical event

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
| `task_done` | The agent finished responding (`text` is ignored — the core uses the stored request) |
| `background_done` | Background work finished (a subagent, a queued task) |
| `needs_input` | The agent is blocked on a permission or a question |

`type`, `agent` and `session_id` are required; an event missing any of them is
dropped and logged as `ignored: incomplete event`. `session_id` must be stable
for the whole session. Never compute a duration — the core does.

## Agents with no hooks

Use `agent-voice wrap -- <command>`: it marks the start, runs the command, and
marks the end.

## Checklist

- [ ] `translate` returns `null` for unknown subcommands and never throws on garbage
- [ ] `agentName` in `src/core/phrases.js` has a spoken name for the agent
- [ ] A test file `tests/adapter-<agent>.test.js` mirroring `tests/adapter-codex.test.js`
- [ ] The adapter is listed in `src/adapters/index.js`
