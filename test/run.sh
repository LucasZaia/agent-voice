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
