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
  if printf '%s\n' "$3" | grep -F "$2" >/dev/null 2>&1; then
    PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf 'FAIL %s\n       missing: [%s]\n       in:      [%s]\n' "$1" "$2" "$3"
  fi
}

. "$AV_ROOT/config.sh"
. "$AV_ROOT/lib/log.sh"

# --- config -----------------------------------------------------------------
check "config: default threshold" "60" "$AV_MIN_SECONDS"
check "config: default cooldown" "120" "$AV_COOLDOWN_SECONDS"

# --- log --------------------------------------------------------------------
av_log "claude-code" "sess1" "hello"
LOG_LINE="$(cat "$AV_STATE_DIR/events.log")"

check_contains "log: writes the message" "hello" "$LOG_LINE"
check_contains "log: writes the agent" "claude-code" "$LOG_LINE"

# FINDING 1: timestamp shape at start of line (YYYY-MM-DD HH:MM:SS), anchored
if [[ "$LOG_LINE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2} ]]; then
  PASS=$((PASS + 1)); printf 'ok   %s\n' "log: timestamp format YYYY-MM-DD HH:MM:SS at start"
else
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n       expected timestamp at start matching YYYY-MM-DD HH:MM:SS\n       actual:   [%s]\n' "log: timestamp format YYYY-MM-DD HH:MM:SS at start" "$LOG_LINE"
fi

# FINDING 1: field order - timestamp, agent, session, message in that order
if [[ "$LOG_LINE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\ +claude-code\ +sess1\ +hello ]]; then
  PASS=$((PASS + 1)); printf 'ok   %s\n' "log: field order is timestamp, agent, session, message"
else
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n       expected order: timestamp, claude-code, sess1, hello\n       actual:   [%s]\n' "log: field order is timestamp, agent, session, message" "$LOG_LINE"
fi

# FINDING 1: session truncation to 8 characters
av_log "test-agent" "long-session-id-1234567890" "truncation-test"
TRUNCATION_LOG="$(tail -1 "$AV_STATE_DIR/events.log")"
check_contains "log: long session ID truncated to 8 chars" "long-ses" "$TRUNCATION_LOG"
# Verify full session id does NOT appear
if printf '%s\n' "$TRUNCATION_LOG" | grep -F "long-session-id-1234567890" >/dev/null 2>&1; then
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n       expected NOT to find full session ID\n' "log: full session ID not in truncated form"
else
  PASS=$((PASS + 1)); printf 'ok   %s\n' "log: full session ID not in truncated form"
fi

# FINDING 2: check_contains handles glob metacharacters as literals
av_log "test-agent" "glob" "message with file*.txt"
GLOB_LOG="$(tail -1 "$AV_STATE_DIR/events.log")"
check_contains "helper: glob metachar * is literal" "file*.txt" "$GLOB_LOG"

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

check "speech: UTF-8 truncation safe at character boundary under C locale" \
  "ação" \
  "$(AV_MAX_SPEECH_CHARS=4 LC_ALL=C bash -c "AV_ROOT='$AV_ROOT' && . \$AV_ROOT/lib/speech.sh && printf 'ação extra stuff' | av_clean_speech")"

check "speech: removes stray brackets not in links or ids" \
  "text with bracket" \
  "$(printf 'text [ with bracket' | av_clean_speech)"

# For the degraded-path test, create a restricted PATH without perl
mkdir -p "$AV_ROOT/test/tmp/path-no-perl"
for cmd in tr sed cut cat printf bash; do ln -sf /usr/bin/$cmd "$AV_ROOT/test/tmp/path-no-perl/" 2>/dev/null || ln -sf /bin/$cmd "$AV_ROOT/test/tmp/path-no-perl/" 2>/dev/null; done

check "speech: degrades gracefully without perl" \
  "hello world" \
  "$(PATH="$AV_ROOT/test/tmp/path-no-perl" bash -c "AV_ROOT='$AV_ROOT' AV_MAX_SPEECH_CHARS=90 && . \$AV_ROOT/lib/speech.sh && printf 'hello world' | av_clean_speech")"

# --- phrases ----------------------------------------------------------------
. "$AV_ROOT/lib/phrases.sh"

check "phrases: known agent gets a display name" \
  "Claude Code" "$(av_agent_name claude-code)"
check "phrases: unknown agent falls back to its id" \
  "codex" "$(av_agent_name codex)"

check "phrases: session label is stable" \
  "$(av_session_label abc123)" "$(av_session_label abc123)"

check "phrases: where prefers the session name" \
  "na sessão Home assistant repo" \
  "$(av_where "sid1" "Home assistant repo" "home-assistant")"
check "phrases: where falls back to label plus project" \
  "na sessão $(av_session_label sid1), do projeto home-assistant" \
  "$(av_where "sid1" "" "home-assistant")"
check "phrases: where with neither name nor project" \
  "na sessão $(av_session_label sid1)" \
  "$(av_where "sid1" "" "")"

check "phrases: one minute is singular" "cerca de um minuto" "$(av_duration_phrase 61)"
check "phrases: several minutes" "cerca de 4 minutos" "$(av_duration_phrase 240)"

check "phrases: task done with request" \
  "Claude Code terminou na sessão X, depois de cerca de 4 minutos. Você tinha pedido: criar o compose." \
  "$(av_phrase_task_done "Claude Code" "na sessão X" "cerca de 4 minutos" "criar o compose")"
check "phrases: task done without request" \
  "Claude Code terminou na sessão X, depois de cerca de 4 minutos." \
  "$(av_phrase_task_done "Claude Code" "na sessão X" "cerca de 4 minutos" "")"

check "phrases: background done" \
  "Claude Code terminou um trabalho em segundo plano na sessão X. Era: revisor." \
  "$(av_phrase_background_done "Claude Code" "na sessão X" "revisor")"

check "phrases: needs input" \
  "Claude Code precisa de você na sessão X. permission needed." \
  "$(av_phrase_needs_input "Claude Code" "na sessão X" "permission needed")"

# --- state ------------------------------------------------------------------
. "$AV_ROOT/lib/state.sh"

av_turn_start "claude-code" "s-a" "pedido da sessao A"
check "state: stores the request text" \
  "pedido da sessao A" "$(av_turn_text claude-code s-a)"
check "state: elapsed is a number" \
  "0" "$(av_turn_elapsed claude-code s-a)"

# Backdate the marker to simulate a long turn.
SA_PATH="$(av_state_path claude-code s-a)"
printf '%s' "$(( $(date +%s) - 300 ))" > "$SA_PATH.start"
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
SC_PATH="$(av_state_path claude-code s-c)"
printf '%s' "$(( $(date +%s) - 200 ))" > "$SC_PATH.cooldown"
av_cooldown_ok claude-code s-c; check "state: cooldown reopens after the window" "0" "$?"

# Path traversal test: resolved path must stay inside AV_STATE_DIR
av_turn_start "claude-code" "../../etc/passwd" "test"
RESOLVED_PATH="$(av_state_path "claude-code" "../../etc/passwd")"
# Check that the resolved path is inside AV_STATE_DIR and contains no escape characters
if [[ "$RESOLVED_PATH" == "$AV_STATE_DIR"/* ]] && ! grep -q '\.\.' <<< "$RESOLVED_PATH"; then
  PASS=$((PASS + 1)); printf 'ok   %s\n' "state: path traversal resolved inside AV_STATE_DIR"
else
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "state: path traversal resolved inside AV_STATE_DIR"
fi

# Verify no files exist outside AV_STATE_DIR after the attack attempt
if [ ! -f "/etc/passwd.start" ] && [ ! -f "/etc/passwd.text" ] && [ ! -f "/../../etc/passwd.start" ]; then
  PASS=$((PASS + 1)); printf 'ok   %s\n' "state: no files created outside AV_STATE_DIR"
else
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "state: no files created outside AV_STATE_DIR"
fi

# Collision test: different session IDs should not collide
av_turn_start "claude-code" "a/b" "text from a/b"
av_turn_start "claude-code" "ab" "text from ab"
TEXT_AB_SLASH="$(av_turn_text claude-code a/b)"
TEXT_AB="$(av_turn_text claude-code ab)"
if [ "$TEXT_AB_SLASH" = "text from a/b" ] && [ "$TEXT_AB" = "text from ab" ]; then
  PASS=$((PASS + 1)); printf 'ok   %s\n' "state: session IDs with different separators do not collide"
else
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n       a/b got: [%s], ab got: [%s]\n' "state: session IDs with different separators do not collide" "$TEXT_AB_SLASH" "$TEXT_AB"
fi

# Clock skew test: future timestamp should return 0, not negative
av_turn_start "claude-code" "skew-test" "clock skew"
FUTURE_TIME=$(( $(date +%s) + 100 ))
SKEW_PATH="$(av_state_path claude-code skew-test)"
printf '%s' "$FUTURE_TIME" > "$SKEW_PATH.start"
SKEW_ELAPSED="$(av_turn_elapsed claude-code skew-test)"
if [ "$SKEW_ELAPSED" = "0" ]; then
  PASS=$((PASS + 1)); printf 'ok   %s\n' "state: future timestamp clamped to 0"
else
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n       expected 0, got: [%s]\n' "state: future timestamp clamped to 0" "$SKEW_ELAPSED"
fi

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
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code c2).start"
ev task_done c2 "Repo X" "proj" | av_handle
check "core: long turn speaks" \
  "Claude Code terminou na sessão Repo X, depois de cerca de 4 minutos. Você tinha pedido: criar o compose." \
  "$(spoken_last)"

# A burst of background events collapses to one.
spoken_reset
for i in 1 2 3 4; do ev background_done c3 "Repo X" "proj" "revisor $i" | av_handle; done
check "core: background burst collapses" "1" "$(spoken_count)"

# needs_input is never filtered, even inside the cooldown.
ev needs_input c3 "Repo X" "proj" "permission needed" | av_handle
check "core: needs_input ignores the cooldown" \
  "Claude Code precisa de você na sessão Repo X. permission needed." \
  "$(spoken_last)"

# Falls back to the derived label with no session name.
spoken_reset
ev turn_start c4 "" "proj" "x" | av_handle
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code c4).start"
ev task_done c4 "" "proj" | av_handle
check_contains "core: falls back to the session label" \
  "na sessão $(av_session_label c4), do projeto proj" "$(spoken_last)"

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
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code cA).start"
printf '%s' "$(( $(date +%s) - 600 ))" > "$(av_state_path claude-code cB).start"
ev task_done cB "Sessao B" "proj-b" | av_handle
ev task_done cA "Sessao A" "proj-a" | av_handle
check "core: concurrent sessions both speak" "2" "$(spoken_count)"
check_contains "core: session B keeps its own request" "pedido B" "$(head -1 "$AV_SPOKEN")"
check_contains "core: session A keeps its own request" "pedido A" "$(tail -1 "$AV_SPOKEN")"
check_contains "core: session B keeps its own duration" "cerca de 10 minutos" "$(head -1 "$AV_SPOKEN")"

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

# --- entry point ------------------------------------------------------------
NOTIFY="$AV_ROOT/bin/notify"

spoken_reset
printf '{"session_id":"e1","cwd":"/a/proj","prompt":"tarefa longa"}' | "$NOTIFY" claude-code start
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code e1).start"
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

# Tier 1: test readlink -f (with Tier 2 & 3 disabled)
mkdir -p "$AV_ROOT/test/tmp/path-tier1-only"
for cmd in tr sed cut cat printf bash; do
  ln -sf /usr/bin/$cmd "$AV_ROOT/test/tmp/path-tier1-only/$cmd" 2>/dev/null || ln -sf /bin/$cmd "$AV_ROOT/test/tmp/path-tier1-only/$cmd" 2>/dev/null
done
# Shim readlink: allow -f to pass through, fail on plain readlink (so Tier 2 fails)
cat > "$AV_ROOT/test/tmp/path-tier1-only/readlink" <<'EOFRL'
#!/bin/bash
[[ "$*" == *"-f"* ]] && exec /usr/bin/readlink "$@"
exit 1
EOFRL
chmod +x "$AV_ROOT/test/tmp/path-tier1-only/readlink"
# Make ls fail (so Tier 3 can't run)
cat > "$AV_ROOT/test/tmp/path-tier1-only/ls" <<'EOFLS'
#!/bin/bash
exit 1
EOFLS
chmod +x "$AV_ROOT/test/tmp/path-tier1-only/ls"
SYMLINK_DIR="$AV_ROOT/test/tmp/symlink-dir"
mkdir -p "$SYMLINK_DIR"
ln -sf "$NOTIFY" "$SYMLINK_DIR/notify-t1"
PATH_SAVE="$PATH"
export PATH="$AV_ROOT/test/tmp/path-tier1-only:$PATH"
spoken_reset
printf '{"session_id":"sym-t1","cwd":"/a/proj","prompt":"via symlink t1"}' | "$SYMLINK_DIR/notify-t1" claude-code start 2>/tmp/notify-err-t1
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code sym-t1).start"
printf '{"session_id":"sym-t1","cwd":"/a/proj"}' | "$SYMLINK_DIR/notify-t1" claude-code stop 2>>/tmp/notify-err-t1
check_contains "notify: tier 1 (readlink -f) end to end" "Claude Code terminou" "$(spoken_last)"
STDERR_SIZE=$(wc -c < /tmp/notify-err-t1 2>/dev/null || echo 0)
check "notify: tier 1 stderr empty" "0" "$STDERR_SIZE"
rm -f /tmp/notify-err-t1
export PATH="$PATH_SAVE"

# Tier 2: test plain readlink without -f support (and no ls)
mkdir -p "$AV_ROOT/test/tmp/path-tier2-only"
for cmd in tr sed cut cat printf bash; do
  ln -sf /usr/bin/$cmd "$AV_ROOT/test/tmp/path-tier2-only/$cmd" 2>/dev/null || ln -sf /bin/$cmd "$AV_ROOT/test/tmp/path-tier2-only/$cmd" 2>/dev/null
done
# Shim readlink: rejects -f but delegates plain calls
cat > "$AV_ROOT/test/tmp/path-tier2-only/readlink" <<'EOFRL'
#!/bin/bash
[[ "$*" == *"-f"* ]] && exit 1
/usr/bin/readlink "$@" 2>/dev/null || /bin/readlink "$@" 2>/dev/null || exit 1
EOFRL
chmod +x "$AV_ROOT/test/tmp/path-tier2-only/readlink"
# Make ls fail so Tier 3 can't run
cat > "$AV_ROOT/test/tmp/path-tier2-only/ls" <<'EOFLS'
#!/bin/bash
exit 1
EOFLS
chmod +x "$AV_ROOT/test/tmp/path-tier2-only/ls"
PATH_SAVE="$PATH"
export PATH="$AV_ROOT/test/tmp/path-tier2-only:$PATH"
spoken_reset
printf '{"session_id":"sym-t2","cwd":"/a/proj","prompt":"via tier 2"}' | "$SYMLINK_DIR/notify-t1" claude-code start 2>/tmp/notify-err-t2
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code sym-t2).start"
printf '{"session_id":"sym-t2","cwd":"/a/proj"}' | "$SYMLINK_DIR/notify-t1" claude-code stop 2>>/tmp/notify-err-t2
check_contains "notify: tier 2 (readlink loop) end to end" "Claude Code terminou" "$(spoken_last)"
STDERR_SIZE=$(wc -c < /tmp/notify-err-t2 2>/dev/null || echo 0)
check "notify: tier 2 stderr empty" "0" "$STDERR_SIZE"
rm -f /tmp/notify-err-t2
export PATH="$PATH_SAVE"

# Tier 3: test ls -ld parsing without readlink
mkdir -p "$AV_ROOT/test/tmp/path-tier3-only"
for cmd in tr sed cut cat printf bash ls; do
  ln -sf /usr/bin/$cmd "$AV_ROOT/test/tmp/path-tier3-only/$cmd" 2>/dev/null || ln -sf /bin/$cmd "$AV_ROOT/test/tmp/path-tier3-only/$cmd" 2>/dev/null
done
# Make readlink fail (so Tier 1 & 2 can't run)
cat > "$AV_ROOT/test/tmp/path-tier3-only/readlink" <<'EOFRL'
#!/bin/bash
exit 1
EOFRL
chmod +x "$AV_ROOT/test/tmp/path-tier3-only/readlink"
export PATH="$AV_ROOT/test/tmp/path-tier3-only:$PATH"
spoken_reset
printf '{"session_id":"sym-t3","cwd":"/a/proj","prompt":"via tier 3"}' | "$SYMLINK_DIR/notify-t1" claude-code start 2>/tmp/notify-err-t3
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code sym-t3).start"
printf '{"session_id":"sym-t3","cwd":"/a/proj"}' | "$SYMLINK_DIR/notify-t1" claude-code stop 2>>/tmp/notify-err-t3
check_contains "notify: tier 3 (ls -ld) end to end" "Claude Code terminou" "$(spoken_last)"
STDERR_SIZE=$(wc -c < /tmp/notify-err-t3 2>/dev/null || echo 0)
check "notify: tier 3 stderr empty" "0" "$STDERR_SIZE"
rm -f /tmp/notify-err-t3
export PATH="$PATH_SAVE"

# Chain of two symlinks test
ln -sf "$SYMLINK_DIR/notify-t1" "$SYMLINK_DIR/notify-chain"
spoken_reset
printf '{"session_id":"sym-chain","cwd":"/a/proj","prompt":"chain of two"}' | "$SYMLINK_DIR/notify-chain" claude-code start 2>/tmp/notify-err-chain
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code sym-chain).start"
printf '{"session_id":"sym-chain","cwd":"/a/proj"}' | "$SYMLINK_DIR/notify-chain" claude-code stop 2>>/tmp/notify-err-chain
check_contains "notify: chain of symlinks end to end" "Claude Code terminou" "$(spoken_last)"
STDERR_SIZE=$(wc -c < /tmp/notify-err-chain 2>/dev/null || echo 0)
check "notify: chain stderr empty" "0" "$STDERR_SIZE"
rm -f /tmp/notify-err-chain

# Hop limit verification: code has max_hops=40 to prevent infinite loops
# (Actual cycle detection is tested via mutation: disabling hop limit causes infinite loop)
grep -q "max_hops=40" "$NOTIFY" && {
  PASS=$((PASS + 1)); printf 'ok   %s\n' "notify: cycle protection (hop limit) is in code"
} || {
  FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "notify: cycle protection (hop limit) is in code"
}

# Failing adapter test: adapter exits non-zero, notify still exits 0
cat > "$AV_ROOT/adapters/fail-adapter.sh" <<'EOF'
#!/bin/bash
printf '{"type":"turn_start","agent":"fail-adapter","session_id":"f1"}'
exit 42
EOF
chmod +x "$AV_ROOT/adapters/fail-adapter.sh"
spoken_reset
printf '{}' | "$NOTIFY" fail-adapter start 2>&1 >/dev/null
check "notify: failing adapter exits 0" "0" "$?"
rm "$AV_ROOT/adapters/fail-adapter.sh"

# Failing output test: outputs fail, notify still exits 0
mkdir -p "$AV_ROOT/test/tmp/outputs"
cat > "$AV_ROOT/test/tmp/outputs/fail.sh" <<'EOF'
#!/bin/bash
echo "output: $*"
exit 99
EOF
chmod +x "$AV_ROOT/test/tmp/outputs/fail.sh"
export AV_OUTPUTS="fail"
spoken_reset
printf '{"session_id":"f2","cwd":"/a/proj","prompt":"test"}' | "$NOTIFY" claude-code start
printf '%s' "$(( $(date +%s) - 240 ))" > "$(av_state_path claude-code f2).start"
printf '{}' | "$NOTIFY" claude-code stop 2>&1 >/dev/null
check "notify: failing output exits 0" "0" "$?"
export AV_OUTPUTS="alexa"
rm "$AV_ROOT/test/tmp/outputs/fail.sh"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
