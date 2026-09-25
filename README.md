# agent-voice

**Make your coding agent talk to you.** When Claude Code or Codex finishes a
long task — or gets stuck waiting for your permission — a speaker says so out
loud:

> *"Claude Code terminou na sessão Home assistant repo, depois de cerca de 4
> minutos. Você tinha pedido: criar o docker compose."*

> *"Codex precisa de você na sessão azul, do projeto api, para usar o Bash."*

Works on macOS, Windows and Linux. Speaks through an Echo (via Home Assistant),
your computer's own voice, or any command you like.

## Install

Requires Node.js 20 or newer.

```bash
npm install -g @lucas_zaia/agent-voice
agent-voice setup
```

`setup` finds your agents, adds its hooks to them (showing you exactly what it
adds, and backing up the file first), asks how you want it to speak, and says a
test sentence so you know it works.

**Windows PowerShell** blocks npm's `.ps1` launchers by default ("execução de
scripts foi desabilitada" / "running scripts is disabled"). Either allow them
for your user once — `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` —
or call `npm.cmd` and `agent-voice.cmd` instead. The agent hooks are not
affected: they run `agent-voice.cmd`.

Running from a checkout instead? Either `npm link` in the checkout (so
`agent-voice` is on your PATH), or tell the hooks how to call it before
connecting:

```bash
AV_HOOK_COMMAND="node /path/to/agent-voice/bin/agent-voice.js" agent-voice connect claude-code
```

`AV_HOOK_COMMAND` is the command written into the agent's hooks (default
`agent-voice`); it is read when you run `setup` or `connect`.

## Why

You ask an agent for something that takes a while and stop watching. Then
either the work finishes and sits there, or — worse — it stopped thirty seconds
in at a permission prompt. A popup appears in the window you stopped looking
at. A voice does not. agent-voice follows two rules:

- **Say something specific**: which session, and what you had asked for.
- **Stay quiet most of the time**: short turns are never announced.

## When it speaks

| Situation | What happens |
|---|---|
| A turn finishes in under 30s | Silent |
| A turn finishes in over 30s | **Speaks**, with how long it took and what you asked |
| Background work finishes (a subagent, a task) | **Speaks**, at most once every 120s per session |
| Background work with nothing to report | Silent |
| The agent needs your permission or input | **Always speaks** |

Every decision, including every silence, goes to the log with its reason —
`agent-voice status` shows the latest lines.

## Commands

```
agent-voice setup                         guided setup
agent-voice connect <claude-code|codex>   add hooks to an agent (--yes to skip the question)
agent-voice disconnect <claude-code|codex>
agent-voice output add <alexa|local|command> [name]
agent-voice output list | remove | enable | disable | test [name]
agent-voice wrap [--name <label>] -- <command...>
agent-voice status
agent-voice config get [key] | set <key> <value> | reset <key>
agent-voice test
```

## Speakers

| Type | How | Needs |
|---|---|---|
| `alexa` | Home Assistant's `notify.send_message` on an Echo entity | Home Assistant URL, a long-lived token, and the Alexa Media Player integration |
| `local` | `say` (macOS), SAPI (Windows), `spd-say`/`espeak-ng` (Linux) | Nothing on macOS/Windows; `espeak-ng` or speech-dispatcher on Linux |
| `command` | Runs any command; `{text}` in it is replaced by the sentence, otherwise the sentence goes to stdin | The command |

You can have several, e.g. `alexa-sala` and `alexa-escritorio`; every enabled
output speaks, each given up to 15 seconds.

A `command` never goes through a shell: arguments are passed as typed, and a
leading `~`, `$HOME` or `%USERPROFILE%` means your home directory. On Windows a
`.cmd`/`.bat` speaker is run through `cmd.exe` with every argument quoted and
escaped, so the sentence can never run anything; a batch file sees it with
`^` escapes, which disappear when it passes `%*` or `%1` on to another program.

## Agents

- **Claude Code** — hooks in `~/.claude/settings.json`.
- **Codex CLI** — hooks in `~/.codex/hooks.json`. Codex runs a hook only after
  you trust it: open Codex and run `/hooks` once after connecting.
- **Anything else** — `agent-voice wrap -- aider ...` announces when the
  command finishes (no "needs you" announcements in this mode).

Adding an agent: see [`docs/adapters.md`](docs/adapters.md).

## Tuning

Tune against your own log. If most of your turns sit below the threshold it
will feel broken — it will simply never speak.

```bash
agent-voice config set minSeconds 20
agent-voice config set cooldownSeconds 300
```

| Key | Default | Env override |
|---|---|---|
| `minSeconds` | 30 | `AV_MIN_SECONDS` |
| `cooldownSeconds` | 120 | `AV_COOLDOWN_SECONDS` |
| `maxSpeechChars` | 90 | `AV_MAX_SPEECH_CHARS` |

## Changing what it says

Each sentence is a template you can reword. `{name}` is a variable; a
`[section]` is spoken only when every variable inside it has a value, so an
empty request drops its whole clause.

| Key | Variables | Default |
|---|---|---|
| `phrases.taskDone` | `{agent}` `{where}` `{duration}` `{request}` | `{agent} terminou {where}, depois de {duration}.[ Você tinha pedido: {request}.]` |
| `phrases.backgroundDone` | `{agent}` `{where}` `{text}` | `{agent} terminou um trabalho em segundo plano {where}.[ Era: {text}.]` |
| `phrases.needsInput` | `{agent}` `{where}` `{notice}` | `{agent} precisa de você {where}{notice}.` |

```bash
agent-voice config set phrases.taskDone "{agent} acabou {where}, levou {duration}.[ Pedido: {request}.]"
agent-voice config get phrases.taskDone
agent-voice config reset phrases.taskDone     # back to the default
```

`{where}` is "na sessão <name>" (or a colour plus the project when there is no
name), `{duration}` is "cerca de 4 minutos", and `{notice}` is the agent's
notice translated — ", para usar o Bash" — or empty. A template with an
unknown variable or unbalanced brackets is refused, so the speaker never reads
out broken text.

## Where things live

| | Config | State and `events.log` |
|---|---|---|
| Linux | `~/.config/agent-voice` | `~/.local/state/agent-voice` |
| macOS | `~/Library/Application Support/agent-voice` | `…/agent-voice/state` |
| Windows | `%APPDATA%\agent-voice` | `%LOCALAPPDATA%\agent-voice` |

## Troubleshooting

Run `agent-voice status` first — the reason is almost always in the log lines it prints.

- `silent (turn 21s < 30s)` → working as configured; lower `minSeconds`.
- `FAILED via <output> (…)` → the speaker failed; the parenthesis says why. Try `agent-voice output test <name>`.
- `no such output: <name>` → enabled but not configured; `agent-voice output add`.
- An agent shows `legacy` → it still has the old bash hooks; run `agent-voice connect <agent>`.
- Nothing in the log at all → the hooks are not firing. In Claude Code, open `/hooks` once to reload; in Codex, trust them in `/hooks`.

## Upgrading from the bash version

1. `npm install -g @lucas_zaia/agent-voice`
2. `agent-voice setup` — for the same Echo as before, pick `command` and enter
   `~/softwares/home-assistant/falar.sh -a {text}`, or pick `alexa` to talk to
   Home Assistant directly.
3. `agent-voice connect claude-code` replaces the old `…/bin/notify` hooks.

Existing state in `~/.local/state/agent-voice` is reused as-is.

## Notes

- **It cannot break your agent.** The hook entry point exits 0 no matter what;
  failures go to the log and nowhere else.
- **Language.** Code and docs are English; the spoken sentences are Brazilian
  Portuguese and live in one file, `src/core/phrases.js`.
- **Concurrency.** State is keyed per agent and per session, so parallel
  sessions never mix up their turns, durations or cooldowns.

## License

MIT.
