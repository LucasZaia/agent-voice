# Per-session state, used by the core only. Keyed by agent and session so that
# concurrent sessions — and concurrent agents — never clobber each other.

av_state_path() { # av_state_path <agent> <session_id>  -> path prefix
  local agent agent_safe agent_digest session session_safe session_digest
  agent_safe="$(printf '%s' "$1" | tr -cd 'a-zA-Z0-9_-')"
  agent_digest="$(printf '%s' "$1" | cksum | cut -d' ' -f1)"
  [ -n "$agent_safe" ] || agent_safe="unknown"
  agent="${agent_safe}_${agent_digest}"

  session_safe="$(printf '%s' "$2" | tr -cd 'a-zA-Z0-9_-')"
  session_digest="$(printf '%s' "$2" | cksum | cut -d' ' -f1)"
  [ -n "$session_safe" ] || session_safe="unknown"
  session="${session_safe}_${session_digest}"

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
  local p started elapsed; p="$(av_state_path "$1" "$2")"
  [ -f "$p.start" ] || return 1
  started="$(cat "$p.start" 2>/dev/null)"
  case "$started" in ''|*[!0-9]*) return 1 ;; esac
  elapsed=$(( $(date +%s) - started ))
  [ "$elapsed" -lt 0 ] && elapsed=0
  printf '%s' "$elapsed"
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
