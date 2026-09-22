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

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
