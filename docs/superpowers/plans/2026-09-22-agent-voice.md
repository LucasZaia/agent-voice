# agent-voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repository where plugging a new coding agent into spoken notifications costs one stateless translator.

**Architecture:** An adapter translates an agent's native format into a canonical JSON event on stdout. The core owns all state and every decision rule — duration threshold, cooldown, sentence building — and dispatches the finished sentence to outputs. Adapters are pure functions; the core is the only thing that remembers anything.

**Tech Stack:** Bash (POSIX-ish, bash 5), `jq` for JSON, `perl` for emoji stripping (optional, degrades), `cksum` for the session-label fallback. No build step, no package manager.

**Spec:** `docs/superpowers/specs/2026-09-22-agent-voice-design.md`

## Global Constraints

- Identifiers, comments and documentation in English. Spoken sentences in Portuguese, confined to `lib/phrases.sh`.
- Every entry point exits 0 in every scenario. A hook that hangs is worse than a hook that does not exist.
- Adapters store nothing and decide nothing. All state lives under `$AV_STATE_DIR`, keyed by agent and session.
- Every silent decision is logged with its reason.
- All functions are prefixed `av_` to avoid collisions when sourced into a hook's shell.
- All tunables read from the environment with a default: `VAR="${VAR:-default}"`.
- Test isolation: tests set `AV_STATE_DIR` to a temp dir and `AV_SPEAK_CMD` to a stub. No test touches the real state dir or speaks.

---

### Task 1: Foundation — config, log, test harness

**Files:**
- Create: `config.sh`
- Create: `lib/log.sh`
- Create: `test/run.sh`
- Verify: `.gitignore` already ignores `*.log` and `test/tmp/`

**Interfaces:**
- Consumes: nothing
- Produces: `AV_MIN_SECONDS`, `AV_COOLDOWN_SECONDS`, `AV_MAX_SPEECH_CHARS`, `AV_STATE_DIR`, `AV_OUTPUTS`, `AV_SPEAK_CMD`, `AV_ROOT`; `av_log <agent> <session_id> <message>`; test helpers `check <name> <expected> <actual>` and `check_contains <name> <needle> <haystack>`.

- [ ] **Step 1: Write the failing test**

Create `test/run.sh`:

```bash
#!/usr/bin/env bash
# Table-driven regression tests. Never speaks, never touches real state.
set -uo pipefail

AV_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export AV_STATE_DIR="$AV_ROOT/test/tmp/state"
export AV_SPEAK_CMD="$AV_ROOT/test/stub-speak.sh"
export AV_SPOKEN="$AV_ROOT/test/tmp/spoken.txt"
rm -rf "$AV_ROOT/test/tmp"; mkdir -p "$AV_STATE_DIR"

PASS=0; FAIL=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf 'FAIL %s\n       expected: [%s]\n       actual:   [%s]\n' "$1" "$2" "$3"
  fi
}

check_contains() { # check_contains <name> <needle> <haystack>
  case "$3" in
    *"$2"*) PASS=$((PASS + 1)); printf 'ok   %s\n' "$1" ;;
    *) FAIL=$((FAIL + 1)); printf 'FAIL %s\n       missing: [%s]\n       in:      [%s]\n' "$1" "$2" "$3" ;;
  esac
}

. "$AV_ROOT/config.sh"
. "$AV_ROOT/lib/log.sh"

# --- config -----------------------------------------------------------------
check "config: default threshold" "60" "$AV_MIN_SECONDS"
check "config: default cooldown" "120" "$AV_COOLDOWN_SECONDS"

# --- log --------------------------------------------------------------------
av_log "claude-code" "sess1" "hello"
check_contains "log: writes the message" "hello" "$(cat "$AV_STATE_DIR/events.log")"
check_contains "log: writes the agent" "claude-code" "$(cat "$AV_STATE_DIR/events.log")"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
```

Create `test/stub-speak.sh`:

```bash
#!/usr/bin/env bash
# Stands in for falar.sh during tests: records instead of speaking.
shift 2>/dev/null          # discard the -a flag
printf '%s\n' "$*" >> "${AV_SPOKEN:-/dev/null}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
chmod +x test/run.sh test/stub-speak.sh && ./test/run.sh
```

Expected: FAIL — `config.sh: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `config.sh`:

```bash
# Tunables. Every one can be overridden from the environment, which is how the
# tests stay off the real state directory and off the real Echo.
AV_ROOT="${AV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

AV_MIN_SECONDS="${AV_MIN_SECONDS:-60}"          # below this, a turn is not worth announcing
AV_COOLDOWN_SECONDS="${AV_COOLDOWN_SECONDS:-120}" # minimum gap between background announcements
AV_MAX_SPEECH_CHARS="${AV_MAX_SPEECH_CHARS:-90}"  # cut for the quoted request
AV_STATE_DIR="${AV_STATE_DIR:-$HOME/.local/state/agent-voice}"
AV_OUTPUTS="${AV_OUTPUTS:-alexa}"               # space-separated names of outputs/<name>.sh
AV_SPEAK_CMD="${AV_SPEAK_CMD:-$HOME/softwares/home-assistant/falar.sh}"
```

Create `lib/log.sh`:

```bash
# One line per firing. Without this, a hook that chose to stay silent and a hook
# that died look identical from the outside.
av_log() { # av_log <agent> <session_id> <message>
  mkdir -p "$AV_STATE_DIR" 2>/dev/null
  printf '%s %-12s %-10s %s\n' "$(date '+%F %T')" "$1" "${2:0:8}" "$3" \
    >> "$AV_STATE_DIR/events.log" 2>/dev/null
  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./test/run.sh
```

Expected: PASS — every check green, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add config.sh lib/log.sh test/run.sh test/stub-speak.sh
git commit -m "feat: config, logging and test harness"
```

---

### Task 2: Text cleanup for speech

**Files:**
- Create: `lib/speech.sh`
- Modify: `test/run.sh` (append a new section before the summary block)

**Interfaces:**
- Consumes: `AV_MAX_SPEECH_CHARS` from Task 1
- Produces: `av_clean_speech` (stdin → stdout), `av_strip_trailing_punct` (stdin → stdout)

- [ ] **Step 1: Write the failing test**

Insert into `test/run.sh`, immediately before the `printf '\n%s passed` line:

```bash
# --- speech cleanup ---------------------------------------------------------
. "$AV_ROOT/lib/speech.sh"

check "speech: strips markdown link, keeps label" \
  "olha essa card e arruma" \
  "$(printf 'olha [essa card](https://app.clickup.com/t/86a) e arruma' | av_clean_speech)"

check "speech: strips bare URL" \
  "veja isto" \
  "$(printf 'veja https://exemplo.com/x isto' | av_clean_speech)"

check "speech: underscore becomes a space" \
  "handler de list pickup" \
  "$(printf 'handler de list_pickup' | av_clean_speech)"

check "speech: drops bracketed card id" \
  "Selly PRO Davi Parra" \
  "$(printf '[#196829] Selly PRO Davi Parra' | av_clean_speech)"

check "speech: collapses doubled periods" \
  "pronto. Foco: x" \
  "$(printf 'pronto.. Foco: x' | av_clean_speech)"

check "speech: newlines become spaces" \
  "uma linha outra linha" \
  "$(printf 'uma linha\noutra linha' | av_clean_speech)"

check "speech: strips trailing punctuation" \
  "travados" \
  "$(printf 'travados.' | av_strip_trailing_punct)"

check "speech: truncates to the limit" \
  "aaaaaaaaaaaaaaaaaaaa" \
  "$(AV_MAX_SPEECH_CHARS=20 av_clean_speech <<< 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"
```

The expected value is exactly 20 `a`s. Comparing the string beats counting
bytes: `wc -c` would also count the trailing newline the pipeline adds.

- [ ] **Step 2: Run test to verify it fails**

```bash
./test/run.sh
```

Expected: FAIL — `lib/speech.sh: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/speech.sh`:

```bash
# Turns written text into something worth hearing. Alexa reading a URL or a card
# id out loud is unbearable, and markdown syntax is noise in speech.

# Emoji live outside the ranges a plain sed can express portably; perl handles
# them and is optional, so the pipeline degrades to a no-op without it.
av_strip_emoji() {
  if command -v perl >/dev/null 2>&1; then
    perl -CSD -pe 's/[\x{2190}-\x{27BF}\x{2300}-\x{23FF}\x{2B00}-\x{2BFF}\x{FE00}-\x{FE0F}\x{1F000}-\x{1FFFF}]//g'
  else
    cat
  fi
}

av_clean_speech() { # stdin -> stdout
  tr '\n' ' ' \
    | sed -E 's/\[([^]]*)\]\([^)]*\)/\1/g
              s#https?://[^ ]*##g
              s/\[#?[0-9]+\][[:space:]]*//g
              s/[][]//g
              s/[`*#>]//g
              s/_/ /g' \
    | av_strip_emoji \
    | sed -E 's/\.{2,}/./g; s/[[:space:]]+/ /g; s/^ //; s/ $//' \
    | cut -c1-"$AV_MAX_SPEECH_CHARS"
}

# Used before joining two fragments, so "travados." + ". Foco" does not become
# "travados.. Foco".
av_strip_trailing_punct() { # stdin -> stdout
  sed -E 's/[[:space:].!:;,-]+$//'
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./test/run.sh
```

Expected: PASS — every check green, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/speech.sh test/run.sh
git commit -m "feat: text cleanup for speech"
```

---

### Task 3: Portuguese sentence templates

**Files:**
- Create: `lib/phrases.sh`
- Modify: `test/run.sh` (append before the summary block)

**Interfaces:**
- Consumes: `av_strip_trailing_punct` from Task 2
- Produces: `av_agent_name <agent>`, `av_session_label <session_id>`, `av_where <session_id> <session_name> <project>`, `av_duration_phrase <seconds>`, `av_phrase_task_done <agent> <where> <duration_phrase> <text>`, `av_phrase_background_done <agent> <where> <text>`, `av_phrase_needs_input <agent> <where> <text>`

- [ ] **Step 1: Write the failing test**

Insert into `test/run.sh` before the summary block:

```bash
# --- phrases ----------------------------------------------------------------
. "$AV_ROOT/lib/phrases.sh"

check "phrases: known agent gets a display name" \
  "Claude Code" "$(av_agent_name claude-code)"
check "phrases: unknown agent falls back to its id" \
  "codex" "$(av_agent_name codex)"

check "phrases: session label is stable" \
  "$(av_session_label abc123)" "$(av_session_label abc123)"

check "phrases: where prefers the session name" \
  "na sessao Home assistant repo" \
  "$(av_where "sid1" "Home assistant repo" "home-assistant")"
check "phrases: where falls back to label plus project" \
  "na sessao $(av_session_label sid1), do projeto home-assistant" \
  "$(av_where "sid1" "" "home-assistant")"
check "phrases: where with neither name nor project" \
  "na sessao $(av_session_label sid1)" \
  "$(av_where "sid1" "" "")"

check "phrases: one minute is singular" "cerca de um minuto" "$(av_duration_phrase 61)"
check "phrases: several minutes" "cerca de 4 minutos" "$(av_duration_phrase 240)"

check "phrases: task done with request" \
  "Claude Code terminou na sessao X, depois de cerca de 4 minutos. Voce tinha pedido: criar o compose." \
  "$(av_phrase_task_done "Claude Code" "na sessao X" "cerca de 4 minutos" "criar o compose")"
check "phrases: task done without request" \
  "Claude Code terminou na sessao X, depois de cerca de 4 minutos." \
  "$(av_phrase_task_done "Claude Code" "na sessao X" "cerca de 4 minutos" "")"

check "phrases: background done" \
  "Claude Code terminou um trabalho em segundo plano na sessao X. Era: revisor." \
  "$(av_phrase_background_done "Claude Code" "na sessao X" "revisor")"

check "phrases: needs input" \
  "Claude Code precisa de voce na sessao X. permission needed." \
  "$(av_phrase_needs_input "Claude Code" "na sessao X" "permission needed")"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./test/run.sh
```

Expected: FAIL — `lib/phrases.sh: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/phrases.sh`:

```bash
# Everything spoken lives here, and it is the only file in Portuguese. Adding a
# language, or changing what Alexa says, touches this file and nothing else.

av_agent_name() { # av_agent_name <agent>
  case "$1" in
    claude-code) printf 'Claude Code' ;;
    *)           printf '%s' "$1" ;;
  esac
}

# Spoken fallback identity when an agent cannot supply a real session name.
# "sessao zero quatro ce zero" is useless to hear; a colour is not.
AV_LABELS="azul verde vermelha amarela roxa laranja dourada prateada turquesa violeta"

av_session_label() { # av_session_label <session_id>
  local count hash
  count=$(printf '%s' "$AV_LABELS" | wc -w)
  hash=$(printf '%s' "$1" | cksum | cut -d' ' -f1)
  printf '%s' "$AV_LABELS" | cut -d' ' -f$(( hash % count + 1 ))
}

av_where() { # av_where <session_id> <session_name> <project>
  if [ -n "$2" ]; then
    printf 'na sessao %s' "$2"
  elif [ -n "$3" ]; then
    printf 'na sessao %s, do projeto %s' "$(av_session_label "$1")" "$3"
  else
    printf 'na sessao %s' "$(av_session_label "$1")"
  fi
}

av_duration_phrase() { # av_duration_phrase <seconds>
  local minutes=$(( ($1 + 30) / 60 ))
  if [ "$minutes" -le 1 ]; then
    printf 'cerca de um minuto'
  else
    printf 'cerca de %s minutos' "$minutes"
  fi
}

av_phrase_task_done() { # <agent_name> <where> <duration_phrase> <text>
  printf '%s terminou %s, depois de %s.' "$1" "$2" "$3"
  [ -n "$4" ] && printf ' Voce tinha pedido: %s.' "$(printf '%s' "$4" | av_strip_trailing_punct)"
  return 0
}

av_phrase_background_done() { # <agent_name> <where> <text>
  printf '%s terminou um trabalho em segundo plano %s.' "$1" "$2"
  [ -n "$3" ] && printf ' Era: %s.' "$(printf '%s' "$3" | av_strip_trailing_punct)"
  return 0
}

av_phrase_needs_input() { # <agent_name> <where> <text>
  printf '%s precisa de voce %s.' "$1" "$2"
  [ -n "$3" ] && printf ' %s.' "$(printf '%s' "$3" | av_strip_trailing_punct)"
  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./test/run.sh
```

Expected: PASS — every check green, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/phrases.sh test/run.sh
git commit -m "feat: Portuguese sentence templates"
```

---

### Task 4: Per-session state

**Files:**
- Create: `lib/state.sh`
- Modify: `test/run.sh` (append before the summary block)

**Interfaces:**
- Consumes: `AV_STATE_DIR`, `AV_COOLDOWN_SECONDS` from Task 1
- Produces: `av_turn_start <agent> <session_id> <text>`, `av_turn_elapsed <agent> <session_id>` (prints seconds, returns 1 if no marker), `av_turn_text <agent> <session_id>`, `av_turn_clear <agent> <session_id>`, `av_cooldown_stamp <agent> <session_id>`, `av_cooldown_ok <agent> <session_id>` (returns 0 when allowed)

- [ ] **Step 1: Write the failing test**

Insert into `test/run.sh` before the summary block:

```bash
# --- state ------------------------------------------------------------------
. "$AV_ROOT/lib/state.sh"

av_turn_start "claude-code" "s-a" "pedido da sessao A"
check "state: stores the request text" \
  "pedido da sessao A" "$(av_turn_text claude-code s-a)"
check "state: elapsed is a number" \
  "0" "$(av_turn_elapsed claude-code s-a)"

# Backdate the marker to simulate a long turn.
printf '%s' "$(( $(date +%s) - 300 ))" > "$AV_STATE_DIR/claude-code/s-a.start"
check "state: elapsed reflects a backdated marker" \
  "300" "$(av_turn_elapsed claude-code s-a)"

# Two sessions must not clobber each other.
av_turn_start "claude-code" "s-b" "pedido da sessao B"
check "state: sessions are isolated" \
  "pedido da sessao A" "$(av_turn_text claude-code s-a)"

av_turn_clear claude-code s-a
av_turn_elapsed claude-code s-a >/dev/null 2>&1
check "state: elapsed fails after clear" "1" "$?"
check "state: clearing one session leaves the other" \
  "pedido da sessao B" "$(av_turn_text claude-code s-b)"

# Cooldown.
av_cooldown_ok claude-code s-c; check "state: cooldown open when unset" "0" "$?"
av_cooldown_stamp claude-code s-c
av_cooldown_ok claude-code s-c; check "state: cooldown closed right after" "1" "$?"
printf '%s' "$(( $(date +%s) - 200 ))" > "$AV_STATE_DIR/claude-code/s-c.cooldown"
av_cooldown_ok claude-code s-c; check "state: cooldown reopens after the window" "0" "$?"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./test/run.sh
```

Expected: FAIL — `lib/state.sh: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/state.sh`:

```bash
# Per-session state, used by the core only. Keyed by agent and session so that
# concurrent sessions — and concurrent agents — never clobber each other.

av_state_path() { # av_state_path <agent> <session_id>  -> path prefix
  local agent session
  agent="$(printf '%s' "$1" | tr -cd 'a-zA-Z0-9_-')"
  session="$(printf '%s' "$2" | tr -cd 'a-zA-Z0-9_-')"
  [ -n "$agent" ] || agent="unknown"
  [ -n "$session" ] || session="unknown"
  mkdir -p "$AV_STATE_DIR/$agent" 2>/dev/null
  printf '%s/%s/%s' "$AV_STATE_DIR" "$agent" "$session"
}

av_turn_start() { # av_turn_start <agent> <session_id> <text>
  local p; p="$(av_state_path "$1" "$2")"
  date +%s > "$p.start" 2>/dev/null
  printf '%s' "$3" > "$p.text" 2>/dev/null
  return 0
}

av_turn_elapsed() { # av_turn_elapsed <agent> <session_id> -> seconds | rc 1
  local p started; p="$(av_state_path "$1" "$2")"
  [ -f "$p.start" ] || return 1
  started="$(cat "$p.start" 2>/dev/null)"
  case "$started" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$(( $(date +%s) - started ))"
}

av_turn_text() { # av_turn_text <agent> <session_id>
  cat "$(av_state_path "$1" "$2").text" 2>/dev/null
  return 0
}

av_turn_clear() { # av_turn_clear <agent> <session_id>
  local p; p="$(av_state_path "$1" "$2")"
  rm -f "$p.start" "$p.text" 2>/dev/null
  return 0
}

av_cooldown_stamp() { # av_cooldown_stamp <agent> <session_id>
  date +%s > "$(av_state_path "$1" "$2").cooldown" 2>/dev/null
  return 0
}

av_cooldown_ok() { # av_cooldown_ok <agent> <session_id> -> rc 0 when allowed
  local p last; p="$(av_state_path "$1" "$2")"
  [ -f "$p.cooldown" ] || return 0
  last="$(cat "$p.cooldown" 2>/dev/null)"
  case "$last" in ''|*[!0-9]*) return 0 ;; esac
  [ $(( $(date +%s) - last )) -ge "$AV_COOLDOWN_SECONDS" ]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./test/run.sh
```

Expected: PASS — every check green, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/state.sh test/run.sh
git commit -m "feat: per-session state keyed by agent and session"
```

---

### Task 5: The core decision engine

**Files:**
- Create: `lib/core.sh`
- Create: `outputs/alexa.sh`
- Modify: `test/run.sh` (append before the summary block)

**Interfaces:**
- Consumes: everything from Tasks 1–4
- Produces: `av_handle` (canonical event JSON on stdin), `av_speak <agent> <session_id> <sentence>`

- [ ] **Step 1: Write the failing test**

Insert into `test/run.sh` before the summary block:

```bash
# --- core -------------------------------------------------------------------
. "$AV_ROOT/lib/core.sh"

spoken_reset() { : > "$AV_SPOKEN"; }
spoken_last() { tail -1 "$AV_SPOKEN" 2>/dev/null; }
spoken_count() { wc -l < "$AV_SPOKEN" 2>/dev/null | tr -d ' '; }

ev() { # ev <type> <session_id> [name] [project] [text]
  jq -n --arg t "$1" --arg s "$2" --arg n "${3:-}" --arg p "${4:-}" --arg x "${5:-}" \
    '{type:$t, agent:"claude-code", session_id:$s, session_name:$n, project:$p, text:$x}'
}

# A short turn stays silent.
spoken_reset
ev turn_start c1 "Repo X" "proj" "pedido curto" | av_handle
ev task_done c1 "Repo X" "proj" | av_handle
check "core: short turn is silent" "0" "$(spoken_count)"
check_contains "core: short turn logs the reason" "silent (turn" "$(cat "$AV_STATE_DIR/events.log")"

# A long turn speaks, with duration and the stored request.
spoken_reset
ev turn_start c2 "Repo X" "proj" "criar o compose" | av_handle
printf '%s' "$(( $(date +%s) - 240 ))" > "$AV_STATE_DIR/claude-code/c2.start"
ev task_done c2 "Repo X" "proj" | av_handle
check "core: long turn speaks" \
  "Claude Code terminou na sessao Repo X, depois de cerca de 4 minutos. Voce tinha pedido: criar o compose." \
  "$(spoken_last)"

# A burst of background events collapses to one.
spoken_reset
for i in 1 2 3 4; do ev background_done c3 "Repo X" "proj" "revisor $i" | av_handle; done
check "core: background burst collapses" "1" "$(spoken_count)"

# needs_input is never filtered, even inside the cooldown.
ev needs_input c3 "Repo X" "proj" "permission needed" | av_handle
check "core: needs_input ignores the cooldown" \
  "Claude Code precisa de voce na sessao Repo X. permission needed." \
  "$(spoken_last)"

# Falls back to the derived label with no session name.
spoken_reset
ev turn_start c4 "" "proj" "x" | av_handle
printf '%s' "$(( $(date +%s) - 240 ))" > "$AV_STATE_DIR/claude-code/c4.start"
ev task_done c4 "" "proj" | av_handle
check_contains "core: falls back to the session label" \
  "na sessao $(av_session_label c4), do projeto proj" "$(spoken_last)"

# task_done with no preceding turn_start does not speak or crash.
spoken_reset
ev task_done c9 "Repo X" "proj" | av_handle
check "core: task_done without a marker is silent" "0" "$(spoken_count)"

# Garbage in, exit 0 out.
printf 'not json' | av_handle
check "core: invalid payload returns 0" "0" "$?"

# Two concurrent sessions produce two distinct sentences.
spoken_reset
ev turn_start cA "Sessao A" "proj-a" "pedido A" | av_handle
ev turn_start cB "Sessao B" "proj-b" "pedido B" | av_handle
printf '%s' "$(( $(date +%s) - 240 ))" > "$AV_STATE_DIR/claude-code/cA.start"
printf '%s' "$(( $(date +%s) - 600 ))" > "$AV_STATE_DIR/claude-code/cB.start"
ev task_done cB "Sessao B" "proj-b" | av_handle
ev task_done cA "Sessao A" "proj-a" | av_handle
check "core: concurrent sessions both speak" "2" "$(spoken_count)"
check_contains "core: session B keeps its own request" "pedido B" "$(head -1 "$AV_SPOKEN")"
check_contains "core: session A keeps its own request" "pedido A" "$(tail -1 "$AV_SPOKEN")"
check_contains "core: session B keeps its own duration" "cerca de 10 minutos" "$(head -1 "$AV_SPOKEN")"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./test/run.sh
```

Expected: FAIL — `lib/core.sh: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/core.sh`:

```bash
# The only component that remembers anything or decides anything. Adapters hand
# it a canonical event; it completes that event from state, applies the rules,
# builds the sentence and dispatches.

. "$AV_ROOT/lib/log.sh"
. "$AV_ROOT/lib/speech.sh"
. "$AV_ROOT/lib/phrases.sh"
. "$AV_ROOT/lib/state.sh"

av_speak() { # av_speak <agent> <session_id> <sentence>
  local output
  av_cooldown_stamp "$1" "$2"
  for output in $AV_OUTPUTS; do
    if [ -x "$AV_ROOT/outputs/$output.sh" ]; then
      if printf '%s' "$3" | "$AV_ROOT/outputs/$output.sh"; then
        av_log "$1" "$2" "spoke via $output: $3"
      else
        av_log "$1" "$2" "FAILED via $output: $3"
      fi
    else
      av_log "$1" "$2" "no such output: $output"
    fi
  done
  return 0
}

av_handle() { # canonical event JSON on stdin
  local event type agent session name project text elapsed sentence agent_name where

  event="$(cat 2>/dev/null)"
  type="$(printf '%s' "$event" | jq -r '.type // empty' 2>/dev/null)"
  agent="$(printf '%s' "$event" | jq -r '.agent // empty' 2>/dev/null)"
  session="$(printf '%s' "$event" | jq -r '.session_id // empty' 2>/dev/null)"

  if [ -z "$type" ] || [ -z "$agent" ] || [ -z "$session" ]; then
    av_log "${agent:-?}" "${session:-?}" "ignored: incomplete event"
    return 0
  fi

  name="$(printf '%s' "$event" | jq -r '.session_name // empty' 2>/dev/null)"
  project="$(printf '%s' "$event" | jq -r '.project // empty' 2>/dev/null)"
  text="$(printf '%s' "$event" | jq -r '.text // empty' 2>/dev/null)"

  agent_name="$(av_agent_name "$agent")"
  where="$(av_where "$session" "$name" "$project")"

  case "$type" in
    turn_start)
      av_turn_start "$agent" "$session" "$text"
      av_log "$agent" "$session" "turn started"
      return 0
      ;;

    task_done)
      if ! elapsed="$(av_turn_elapsed "$agent" "$session")"; then
        av_log "$agent" "$session" "ignored: task_done with no turn marker"
        return 0
      fi
      # The request came from turn_start; the adapter had no way to know it.
      text="$(av_turn_text "$agent" "$session")"
      av_turn_clear "$agent" "$session"
      if [ "$elapsed" -lt "$AV_MIN_SECONDS" ]; then
        av_log "$agent" "$session" "silent (turn ${elapsed}s < ${AV_MIN_SECONDS}s)"
        return 0
      fi
      sentence="$(av_phrase_task_done "$agent_name" "$where" \
                  "$(av_duration_phrase "$elapsed")" \
                  "$(printf '%s' "$text" | av_clean_speech)")"
      ;;

    background_done)
      if ! av_cooldown_ok "$agent" "$session"; then
        av_log "$agent" "$session" "silent (cooldown ${AV_COOLDOWN_SECONDS}s)"
        return 0
      fi
      sentence="$(av_phrase_background_done "$agent_name" "$where" \
                  "$(printf '%s' "$text" | av_clean_speech)")"
      ;;

    needs_input)
      sentence="$(av_phrase_needs_input "$agent_name" "$where" \
                  "$(printf '%s' "$text" | av_clean_speech)")"
      ;;

    *)
      av_log "$agent" "$session" "ignored: unknown type $type"
      return 0
      ;;
  esac

  av_speak "$agent" "$session" "$sentence"
  return 0
}
```

Create `outputs/alexa.sh`:

```bash
#!/usr/bin/env bash
# Speaks the sentence on the Echo, through the Home Assistant repo's falar.sh.
# falar.sh stays there on purpose: it is the Home Assistant interface, and the
# daily-priorities cron already depends on it.
set -uo pipefail

sentence="$(cat)"
[ -n "$sentence" ] || exit 1
[ -x "$AV_SPEAK_CMD" ] || exit 1

"$AV_SPEAK_CMD" -a "$sentence" >/dev/null 2>&1
```

- [ ] **Step 4: Run test to verify it passes**

```bash
chmod +x outputs/alexa.sh && ./test/run.sh
```

Expected: PASS — every check green, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/core.sh outputs/alexa.sh test/run.sh
git commit -m "feat: core decision engine and Alexa output"
```

---

### Task 6: Claude Code adapter

**Files:**
- Create: `adapters/claude-code.sh`
- Modify: `test/run.sh` (append before the summary block)

**Interfaces:**
- Consumes: nothing from this repo — an adapter is a pure function and sources no library
- Produces: `adapters/claude-code.sh <start|stop|task|notification>` reading Claude Code's hook JSON on stdin and writing one canonical event on stdout

- [ ] **Step 1: Write the failing test**

Insert into `test/run.sh` before the summary block:

```bash
# --- claude-code adapter ----------------------------------------------------
CC="$AV_ROOT/adapters/claude-code.sh"

hook_json='{"session_id":"04c02385","cwd":"/home/u/softwares/home-assistant","prompt":"criar o compose","transcript_path":"/nao/existe.jsonl"}'

check "adapter: start maps to turn_start" \
  "turn_start" "$(printf '%s' "$hook_json" | "$CC" start | jq -r .type)"
check "adapter: carries the agent name" \
  "claude-code" "$(printf '%s' "$hook_json" | "$CC" start | jq -r .agent)"
check "adapter: carries the session id" \
  "04c02385" "$(printf '%s' "$hook_json" | "$CC" start | jq -r .session_id)"
check "adapter: project is the last cwd segment" \
  "home-assistant" "$(printf '%s' "$hook_json" | "$CC" start | jq -r .project)"
check "adapter: text is the prompt" \
  "criar o compose" "$(printf '%s' "$hook_json" | "$CC" start | jq -r .text)"

check "adapter: stop maps to task_done" \
  "task_done" "$(printf '%s' "$hook_json" | "$CC" stop | jq -r .type)"
check "adapter: task maps to background_done" \
  "background_done" "$(printf '%s' "$hook_json" | "$CC" task | jq -r .type)"
check "adapter: notification maps to needs_input" \
  "needs_input" "$(printf '%s' "$hook_json" | "$CC" notification | jq -r .type)"

check "adapter: notification text is the hook message" \
  "permission needed" \
  "$(printf '{"session_id":"s","cwd":"/a/b","message":"permission needed"}' | "$CC" notification | jq -r .text)"

check "adapter: home directory is not a project" \
  "" "$(printf '{"session_id":"s","cwd":"%s","prompt":"x"}' "$HOME" | "$CC" start | jq -r .project)"

# session_name comes from the transcript's most recent ai-title record.
mkdir -p "$AV_ROOT/test/tmp"
TR="$AV_ROOT/test/tmp/fake.jsonl"
printf '%s\n' '{"type":"ai-title","aiTitle":"Older title"}' \
               '{"type":"user","message":"x"}' \
               '{"type":"ai-title","aiTitle":"Home-assistant repo"}' > "$TR"
check "adapter: session name comes from the newest ai-title" \
  "Home assistant repo" \
  "$(jq -n --arg t "$TR" '{session_id:"s",cwd:"/a/b",prompt:"x",transcript_path:$t}' | "$CC" start | jq -r .session_name)"

check "adapter: missing transcript leaves the name empty" \
  "" "$(printf '%s' "$hook_json" | "$CC" start | jq -r .session_name)"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./test/run.sh
```

Expected: FAIL — `adapters/claude-code.sh: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `adapters/claude-code.sh`:

```bash
#!/usr/bin/env bash
# Translates Claude Code hook payloads into canonical events.
#
# Wire-up, in ~/.claude/settings.json:
#   UserPromptSubmit -> notify claude-code start
#   Stop             -> notify claude-code stop
#   SubagentStop     -> notify claude-code task
#   TaskCompleted    -> notify claude-code task
#   Notification     -> notify claude-code notification
#
# This is a pure function: it reads the payload, writes one event, and keeps no
# state. Everything it knows about Claude Code — hook names, field names, where
# the session title hides — is here and nowhere else.
set -uo pipefail

subcommand="${1:-}"
payload="$(cat 2>/dev/null)"

field() { printf '%s' "$payload" | jq -r ".$1 // empty" 2>/dev/null; }

# Claude Code writes an AI-generated session title into the transcript as
# {"type":"ai-title","aiTitle":"..."} and rewrites it as the topic shifts. Read
# from the end: the newest one wins, and tac+grep costs ~3ms on a 3.5MB file
# where a full jq pass would not.
session_name() {
  local transcript title
  transcript="$(field transcript_path)"
  [ -n "$transcript" ] && [ -f "$transcript" ] || return 0
  title="$(tac "$transcript" 2>/dev/null | grep -m1 '"type":"ai-title"' \
           | jq -r '.aiTitle // empty' 2>/dev/null)"
  printf '%s' "$title" | sed -E 's/[_-]+/ /g'
}

# The last segment of cwd. The home directory is not a project — announcing
# "no projeto lucas-zaia" would be nonsense.
project() {
  local dir; dir="$(field cwd | sed -E 's#/+$##')"
  [ -n "$dir" ] || return 0
  [ "$dir" = "$HOME" ] && return 0
  printf '%s' "${dir##*/}"
}

case "$subcommand" in
  start)        type="turn_start";      text="$(field prompt)" ;;
  stop)         type="task_done";       text="" ;;
  task)         type="background_done"; text="$(field agent_type)" ;;
  notification) type="needs_input";     text="$(field message)" ;;
  *)            exit 0 ;;
esac

jq -n \
  --arg type "$type" \
  --arg session_id "$(field session_id)" \
  --arg session_name "$(session_name)" \
  --arg project "$(project)" \
  --arg text "$text" \
  '{type: $type, agent: "claude-code", session_id: $session_id,
    session_name: $session_name, project: $project, text: $text}'
```

- [ ] **Step 4: Run test to verify it passes**

```bash
chmod +x adapters/claude-code.sh && ./test/run.sh
```

Expected: PASS — every check green, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add adapters/claude-code.sh test/run.sh
git commit -m "feat: Claude Code adapter"
```

---

### Task 7: Entry point

**Files:**
- Create: `bin/notify`
- Modify: `test/run.sh` (append before the summary block)

**Interfaces:**
- Consumes: adapters from Task 6, `av_handle` from Task 5
- Produces: `bin/notify <agent> <subcommand>` — the single command every hook calls

- [ ] **Step 1: Write the failing test**

Insert into `test/run.sh` before the summary block:

```bash
# --- entry point ------------------------------------------------------------
NOTIFY="$AV_ROOT/bin/notify"

spoken_reset
printf '{"session_id":"e1","cwd":"/a/proj","prompt":"tarefa longa"}' | "$NOTIFY" claude-code start
printf '%s' "$(( $(date +%s) - 240 ))" > "$AV_STATE_DIR/claude-code/e1.start"
printf '{"session_id":"e1","cwd":"/a/proj"}' | "$NOTIFY" claude-code stop
check_contains "notify: end to end speaks" "Claude Code terminou" "$(spoken_last)"
check_contains "notify: end to end quotes the request" "tarefa longa" "$(spoken_last)"

printf '{}' | "$NOTIFY" nao-existe start
check "notify: unknown agent exits 0" "0" "$?"
check_contains "notify: unknown agent is logged" "no adapter" "$(cat "$AV_STATE_DIR/events.log")"

printf 'lixo' | "$NOTIFY" claude-code start
check "notify: garbage payload exits 0" "0" "$?"

"$NOTIFY" </dev/null
check "notify: no arguments exits 0" "0" "$?"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./test/run.sh
```

Expected: FAIL — `bin/notify: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `bin/notify`:

```bash
#!/usr/bin/env bash
# Single entry point. Every hook, wrapper or watcher calls this:
#
#   notify <agent> <subcommand>      # the agent's native payload on stdin
#
# Exits 0 in every scenario, on purpose: a hook that hangs or fails is worse
# than one that does not exist.
set -uo pipefail

AV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AV_ROOT
. "$AV_ROOT/config.sh"
. "$AV_ROOT/lib/core.sh"

agent="${1:-}"
subcommand="${2:-}"

if [ -z "$agent" ] || [ -z "$subcommand" ]; then
  av_log "${agent:-?}" "-" "ignored: usage is notify <agent> <subcommand>"
  exit 0
fi

adapter="$AV_ROOT/adapters/$agent.sh"
if [ ! -x "$adapter" ]; then
  av_log "$agent" "-" "no adapter at $adapter"
  exit 0
fi

"$adapter" "$subcommand" | av_handle
exit 0
```

- [ ] **Step 4: Run test to verify it passes**

```bash
chmod +x bin/notify && ./test/run.sh
```

Expected: PASS — every check green, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add bin/notify test/run.sh
git commit -m "feat: notify entry point"
```

---

### Task 8: Documentation and cutover

**Files:**
- Create: `README.md`
- Create: `adapters/CONTRACT.md`
- Modify: `~/.claude/settings.json` (the five hook commands)
- Delete: `~/bin/claude-alexa-notify.sh` (last step, only after parity is proven)

**Interfaces:**
- Consumes: everything
- Produces: nothing new — this task swaps the live wiring over

- [ ] **Step 1: Prove parity with the current script**

Run both implementations over the same input and compare the sentences. The old
script speaks through `CLAUDE_ALEXA_FALAR`; the new one through `AV_SPEAK_CMD`.

```bash
cd ~/softwares/agent-voice
export AV_STATE_DIR=/tmp/av-parity/new AV_SPOKEN=/tmp/av-parity/new.txt
export AV_SPEAK_CMD="$PWD/test/stub-speak.sh"
rm -rf /tmp/av-parity; mkdir -p /tmp/av-parity/new /tmp/av-parity/old
: > /tmp/av-parity/new.txt

P='{"session_id":"p1","cwd":"/home/lucas-zaia/softwares/home-assistant","prompt":"criar o docker compose"}'
printf '%s' "$P" | ./bin/notify claude-code start
printf '%s' "$(( $(date +%s) - 240 ))" > /tmp/av-parity/new/claude-code/p1.start
printf '%s' "$P" | ./bin/notify claude-code stop

CLAUDE_ALEXA_FALAR="$PWD/test/stub-speak.sh" AV_SPOKEN=/tmp/av-parity/old.txt \
  bash -c 'printf "%s" "$0" | ~/bin/claude-alexa-notify.sh start' "$P"
printf '%s' "$(( $(date +%s) - 240 ))" > ~/.local/state/claude-alexa/p1.start
CLAUDE_ALEXA_FALAR="$PWD/test/stub-speak.sh" AV_SPOKEN=/tmp/av-parity/old.txt \
  bash -c 'printf "%s" "$0" | ~/bin/claude-alexa-notify.sh stop' "$P"

diff /tmp/av-parity/old.txt /tmp/av-parity/new.txt && echo "PARITY OK"
```

Expected: `PARITY OK`. If the sentences differ, fix the new implementation —
the old one is the reference — and rerun before continuing.

- [ ] **Step 2: Write the adapter contract**

Create `adapters/CONTRACT.md`:

````markdown
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
````

- [ ] **Step 3: Write the README**

Create `README.md`:

````markdown
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

## Language

Code and docs are English. The spoken sentences are Portuguese and live only in
`lib/phrases.sh`.
````

- [ ] **Step 4: Switch the live hooks over**

```bash
cd ~/.claude
cp settings.json /tmp/settings.json.bak
N="/home/lucas-zaia/softwares/agent-voice/bin/notify"
jq --arg n "$N" '
  .hooks.UserPromptSubmit = [{hooks:[{type:"command", command:($n+" claude-code start"), timeout:5}]}]
| .hooks.Stop             = [{hooks:[{type:"command", command:($n+" claude-code stop"), async:true, timeout:20}]}]
| .hooks.SubagentStop     = [{hooks:[{type:"command", command:($n+" claude-code task"), async:true, timeout:20}]}]
| .hooks.TaskCompleted    = [{hooks:[{type:"command", command:($n+" claude-code task"), async:true, timeout:20}]}]
| .hooks.Notification     = [{hooks:[{type:"command", command:($n+" claude-code notification"), async:true, timeout:20}]}]
' /tmp/settings.json.bak > settings.json
jq -e . settings.json >/dev/null && echo "valid JSON"
jq -e '.hooks.SessionStart | length' settings.json    # must still be 1
diff <(jq -S 'del(.hooks)' /tmp/settings.json.bak) <(jq -S 'del(.hooks)' settings.json) && echo "rest intact"
```

Expected: `valid JSON`, `1`, `rest intact`.

- [ ] **Step 5: Confirm a real firing, then remove the old script**

Send any message in a Claude Code session, then:

```bash
tail -3 ~/.local/state/agent-voice/events.log
```

Expected: a `turn started` line from the real session. Only once that appears:

```bash
rm ~/bin/claude-alexa-notify.sh
```

- [ ] **Step 6: Commit**

```bash
cd ~/softwares/agent-voice
git add README.md adapters/CONTRACT.md
git commit -m "docs: README and adapter contract; cut hooks over to agent-voice"
```
