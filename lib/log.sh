# One line per firing. Without this, a hook that chose to stay silent and a hook
# that died look identical from the outside.
av_log() { # av_log <agent> <session_id> <message>
  mkdir -p "$AV_STATE_DIR" 2>/dev/null
  printf '%s %-12s %-10s %s\n' "$(date '+%F %T')" "$1" "${2:0:8}" "$3" \
    >> "$AV_STATE_DIR/events.log" 2>/dev/null
  return 0
}
