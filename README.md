# agent-voice

[![npm](https://img.shields.io/npm/v/@lucas_zaia/agent-voice)](https://www.npmjs.com/package/@lucas_zaia/agent-voice)
[![test](https://github.com/LucasZaia/agent-voice/actions/workflows/test.yml/badge.svg)](https://github.com/LucasZaia/agent-voice/actions/workflows/test.yml)
![node](https://img.shields.io/node/v/@lucas_zaia/agent-voice)
![license](https://img.shields.io/npm/l/@lucas_zaia/agent-voice)

**Make your coding agent talk to you.** When Claude Code or Codex finishes a
long task, or stops to wait for your permission, a speaker says so out loud:

> 🔊 *"Claude Code terminou na sessão Home assistant repo, depois de cerca de 4
> minutos. Você tinha pedido: criar o docker compose."*
>
> 🔊 *"Codex precisa de você na sessão azul, do projeto api, para usar o Bash."*

It works on macOS, Windows and Linux. It can speak through an Amazon Echo (via
[Home Assistant](https://www.home-assistant.io/)), your computer's own voice, or any command you choose. It has
no dependencies and needs only Node.js.

---

## Contents

- [Quick start](#quick-start)
- [Why](#why)
- [When it speaks](#when-it-speaks)
- [Speakers](#speakers): [Echo / Alexa](#echo--alexa-via-home-assistant) · [Computer voice](#your-computers-voice) · [Any command](#any-command)
- [Agents](#agents)
- [Tuning](#tuning)
- [Changing what it says](#changing-what-it-says)
- [Commands](#commands)
- [Windows notes](#windows-notes)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Development](#development)

---

## Quick start

You need Node.js 20 or newer.

```bash
npm install -g @lucas_zaia/agent-voice
agent-voice setup
```

`setup` takes about a minute:

1. **Finds your agents** (Claude Code, Codex) and shows the exact hooks it will
   add. The config file is backed up before anything is written.
2. **Asks how to speak**: Echo, your computer's voice, or a command.
3. **Speaks a test sentence** and asks whether you heard it. If you didn't, it
   removes that speaker and lets you try another.

To check everything afterwards:

```bash
agent-voice status
```

```
Agents
  claude-code  connected
  codex        not installed
Outputs (* = enabled)
  * echo             alexa    notify.echo_dot_announce @ http://homeassistant.local:8123
Settings
  minSeconds=30
  cooldownSeconds=120
  maxSpeechChars=90
Log (~/.local/state/agent-voice/events.log)
  2026-09-25 16:05:23 claude-code  04c02385   spoke via echo: Claude Code terminou na sessão…
  2026-09-25 16:07:41 claude-code  04c02385   silent (turn 12s < 30s)
```

> On Windows, see [Windows notes](#windows-notes) if PowerShell refuses to run `npm`.

---

## Why

You give an agent something that takes a while and stop watching it. Then one
of two things happens: the work finishes and waits for you to notice, or, worse,
the agent stopped at a permission prompt thirty seconds in. A popup shows up in
the window you are no longer looking at. A voice reaches you anyway.

agent-voice follows two rules:

- **Say something specific**: which session it is, how long it took, and what
  you had asked for.
- **Stay quiet most of the time**: short turns are never announced. A notifier
  that talks after every reply gets muted on day one.

---

## When it speaks

| Situation | What happens |
|---|---|
| A turn finishes in **under 30s** | Silent |
| A turn finishes in **over 30s** | **Speaks**, with how long it took and what you asked |
| Background work finishes (a subagent, a task) | **Speaks**, at most once every 120s per session |
| Background work with nothing to report | Silent |
| The agent **needs your permission or input** | **Always speaks**, even inside the cooldown |

Every decision, including every silence, is written to the log with its reason:

```
16:05:23  claude-code  notif1  spoke via echo: Claude Code precisa de você na sessão verde.
15:57:38  claude-code  a891ee  silent (turn 21s < 30s)
15:46:12  claude-code  04c023  silent (background_done with no content)
```

When a session has no name, it gets a color ("na sessão azul, do projeto api").
Colors are easy to tell apart by ear, which random ids are not.

---

## Speakers

A speaker (an *output*) is added with `agent-voice output add <type> [name]`.
You can have several; every enabled one speaks, and each gets at most 15
seconds.

```bash
agent-voice output list            # * marks the enabled ones
agent-voice output test [name]     # speak the test sentence
agent-voice output disable <name>  # keep it, but stop using it
agent-voice output remove <name>
```

### Echo / Alexa (via Home Assistant)

You need:

1. **[Home Assistant](https://www.home-assistant.io/installation/)**, reachable over the network from the
   machine where your agent runs (by default `http://homeassistant.local:8123`).
2. The **[Alexa Media Player](https://github.com/alandtse/alexa_media_player)**
   integration, which creates `notify.<device>_speak` and
   `notify.<device>_announce` entities for each Echo.
3. A **[long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile)**:
   Home Assistant → your profile → *Security* → *Long-lived access tokens* → *Create token*.

```bash
agent-voice output add alexa
```

It asks for the URL and the token, checks the token right away, lists your
`notify.*` devices (with `_announce` first; those play a chime before speaking),
and says the test sentence. The token is stored only in your config directory,
with permissions `600`.

### Your computer's voice

```bash
agent-voice output add local
```

| OS | Engine | Needs |
|---|---|---|
| macOS | `say` | nothing |
| Windows | SAPI (via PowerShell) | nothing |
| Linux | `spd-say`, `espeak-ng` or `espeak` | `sudo apt install espeak-ng` |

A Brazilian Portuguese voice is selected automatically when one is installed.

### Any command

```bash
agent-voice output add command
```

Enter the command line. `{text}` is replaced by the sentence; if there is no
`{text}`, the sentence is sent on stdin. Some examples:

```bash
~/bin/falar.sh -a {text}                          # your own script
curl -s -d {text} ntfy.sh/my-agent-topic          # phone push notification
notify-send agent-voice {text}                    # desktop notification
```

The command never goes through a shell. Arguments are passed exactly as typed,
and a leading `~`, `$HOME` or `%USERPROFILE%` is expanded to your home
directory. On Windows, `.cmd`/`.bat` speakers go through `cmd.exe` with every
argument quoted and escaped, so the sentence can never run anything.

---

## Agents

| Agent | Hooks live in | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/settings.json` | After connecting, open `/hooks` once so a running session reloads its config. |
| **Codex CLI** | `~/.codex/hooks.json` | Codex only runs hooks you have trusted: open Codex and run `/hooks` once after connecting. |
| **Anything else** | none | Use `agent-voice wrap`, below. |

```bash
agent-voice connect claude-code      # asks first; --yes to skip the question
agent-voice disconnect claude-code   # removes only agent-voice's hooks
```

`connect` never changes hooks it did not add. Running it again changes
nothing, and it always backs up the file first (`settings.json.bak-<date>`).

**Any other CLI** (Aider, a long build, a test suite) can use `wrap`. It speaks
when the command finishes, if it ran longer than the threshold:

```bash
agent-voice wrap -- aider --message "refactor the parser"
agent-voice wrap --name "build" -- npm run build
```

The exit code of the wrapped command is passed through. `wrap` cannot announce
"needs you", because it cannot see inside the program.

To support a new agent natively, see [`docs/adapters.md`](docs/adapters.md).

---

## Tuning

Tune the thresholds against your own log. If most of your turns take less
time than the threshold, it will seem broken, because it will simply never
speak.

```bash
agent-voice config get                        # everything, including the phrases
agent-voice config set minSeconds 20
agent-voice config set cooldownSeconds 300
agent-voice config reset minSeconds           # back to the default
```

| Key | Default | Meaning | Env override |
|---|---|---|---|
| `minSeconds` | 30 | A shorter turn is not announced | `AV_MIN_SECONDS` |
| `cooldownSeconds` | 120 | Minimum gap between background announcements, per session | `AV_COOLDOWN_SECONDS` |
| `maxSpeechChars` | 90 | How much of your request is quoted back | `AV_MAX_SPEECH_CHARS` |

---

## Changing what it says

Each sentence is a template you can rewrite:

```bash
agent-voice config set phrases.taskDone "{agent} acabou {where}, levou {duration}.[ Pedido: {request}.]"
agent-voice config set phrases.needsInput "Ei! {agent} precisa de você {where}{notice}."
agent-voice config reset phrases.taskDone     # back to the default
```

`{name}` is a variable. A `[section]` is spoken only when every variable inside
it has a value, so an empty request drops the whole clause instead of leaving
"Pedido: ." behind.

| Key | Variables | Default |
|---|---|---|
| `phrases.taskDone` | `{agent}` `{where}` `{duration}` `{request}` | `{agent} terminou {where}, depois de {duration}.[ Você tinha pedido: {request}.]` |
| `phrases.backgroundDone` | `{agent}` `{where}` `{text}` | `{agent} terminou um trabalho em segundo plano {where}.[ Era: {text}.]` |
| `phrases.needsInput` | `{agent}` `{where}` `{notice}` | `{agent} precisa de você {where}{notice}.` |

| Variable | Example |
|---|---|
| `{agent}` | `Claude Code`, `Codex` |
| `{where}` | `na sessão Home assistant repo` / `na sessão azul, do projeto api` |
| `{duration}` | `cerca de 4 minutos` |
| `{request}` | what you asked, without links, file paths or markdown |
| `{text}` | what the background work was, e.g. `code-reviewer` |
| `{notice}` | the agent's notice, translated: `, para usar o Bash`; empty when it adds nothing |

A template with an unknown variable or unbalanced brackets is refused, so the
speaker never reads out broken text.

---

## Commands

```
agent-voice setup                                     guided setup
agent-voice status                                    agents, outputs, settings, latest log lines
agent-voice test                                      speak a test sentence on every enabled output

agent-voice connect <claude-code|codex> [--yes]       add hooks to an agent
agent-voice disconnect <claude-code|codex>            remove them

agent-voice output add <alexa|local|command> [name]
agent-voice output list | test [name] | enable <name> | disable <name> | remove <name>

agent-voice config get [key] | set <key> <value> | reset <key>
agent-voice wrap [--name <label>] -- <command...>     announce when any command finishes
```

`agent-voice notify <agent> <event>` is also available: it is the hook entry
point, called by your agent. You never need to run it yourself.

---

## Windows notes

**"execução de scripts foi desabilitada" / "running scripts is disabled".**
PowerShell blocks npm's `.ps1` launchers by default. You can allow them once,
for your user only:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Or use `npm.cmd` and `agent-voice.cmd` instead. The agent hooks are not
affected either way, because they call `agent-voice.cmd`.

**"agent-voice não é reconhecido" / "is not recognized".** npm's global folder
is not on your PATH. Add it, then open a new terminal and restart Claude Code:

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$(npm prefix -g)", "User")
```

---

## Troubleshooting

Run `agent-voice status` first. The reason is almost always in the log lines it
prints.

| You see | It means |
|---|---|
| `silent (turn 21s < 30s)` | Working as configured. Lower `minSeconds` if you want it to speak sooner. |
| `silent (cooldown 120s)` | A background announcement was held back so the speaker doesn't chatter. |
| `FAILED via <output> (…)` | The speaker failed; the parenthesis says why. Try `agent-voice output test <name>`. |
| `no such output: <name>` | The output is enabled but not configured. Run `agent-voice output add`. |
| Agent shows `legacy` | It still has hooks from the old bash version. Run `agent-voice connect <agent>`. |
| Nothing in the log at all | The hooks are not firing. Claude Code: open `/hooks` once. Codex: trust them in `/hooks`. Check that `agent-voice` is on the PATH your agent sees. |

**Uninstall:**

```bash
agent-voice disconnect claude-code   # and/or codex
npm rm -g @lucas_zaia/agent-voice
```

---

## How it works

```
agent hook ──▶ adapter ──▶ core ──▶ output ──▶ speaker
              translate    decide    speak
```

| Piece | Job |
|---|---|
| **Adapter** (`src/adapters/`) | Knows one agent. Turns its hook payload into a standard event. Decides nothing. |
| **Core** (`src/core/`) | Knows no agent. Measures turns, applies thresholds and cooldown, cleans the text (no links, paths or markdown), builds the sentence. |
| **Output** (`src/outputs/`) | Takes a finished sentence and makes a device say it. |

Some guarantees:

- **It cannot break your agent.** The hook entry point always exits 0, never
  waits more than a few seconds for input, and writes nothing your agent would
  read. Failures go to the log and nowhere else.
- **Parallel sessions never mix.** State is kept per agent and per session, so
  turns, durations and cooldowns stay separate.
- **Language.** The code and docs are in English. The spoken sentences are in
  Brazilian Portuguese, and you can reword them (see
  [Changing what it says](#changing-what-it-says)).

| | Config | State and `events.log` |
|---|---|---|
| Linux | `~/.config/agent-voice` | `~/.local/state/agent-voice` |
| macOS | `~/Library/Application Support/agent-voice` | `…/agent-voice/state` |
| Windows | `%APPDATA%\agent-voice` | `%LOCALAPPDATA%\agent-voice` |

---

## Development

```bash
git clone https://github.com/LucasZaia/agent-voice.git
cd agent-voice
npm test          # node:test, no dependencies
npm link          # puts this checkout's agent-voice on your PATH
```

To point the hooks at a checkout without `npm link`, set the command they call
before connecting:

```bash
AV_HOOK_COMMAND="node /path/to/agent-voice/bin/agent-voice.js" agent-voice connect claude-code
```

CI runs the suite on Linux, macOS and Windows with Node 20 and 22.

**Upgrading from the old bash version:** install the package, run
`agent-voice setup` (to reuse a speaker script, choose `command`), then run
`agent-voice connect claude-code`. That replaces the old `…/bin/notify` hooks.
The existing state in `~/.local/state/agent-voice` is reused as-is.

## License

MIT
