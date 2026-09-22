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

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
