# The only component that remembers anything or decides anything. Adapters hand
# it a canonical event; it completes that event from state, applies the rules,
# builds the sentence and dispatches.

. "$AV_ROOT/lib/log.sh"
. "$AV_ROOT/lib/speech.sh"
. "$AV_ROOT/lib/phrases.sh"
. "$AV_ROOT/lib/state.sh"

av_speak() { # av_speak <agent> <session_id> <sentence>
  local output err rc reason
  av_cooldown_stamp "$1" "$2"
  for output in $AV_OUTPUTS; do
    if [ -x "$AV_ROOT/outputs/$output.sh" ]; then
      # Capture the output's stderr (not its stdout) so a FAILED line carries
      # a reason. "container down", "token missing", "HTTP 401" and "unbound
      # variable" must stay distinguishable from each other, and from a hook
      # that simply chose to stay quiet.
      err="$(printf '%s' "$3" | { "$AV_ROOT/outputs/$output.sh"; } 2>&1 1>/dev/null)"
      rc=$?
      if [ "$rc" -eq 0 ]; then
        av_log "$1" "$2" "spoke via $output: $3"
      else
        reason="$(printf '%s' "$err" | head -n1 | cut -c1-120)"
        [ -n "$reason" ] || reason="exit $rc, no stderr"
        av_log "$1" "$2" "FAILED via $output ($reason): $3"
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

  # session_name and project come straight from adapter input (an AI-generated
  # transcript title, a directory name) — never spoken-safe by construction.
  # Adapters stay pure translators (see adapters/CONTRACT.md); cleaning what
  # reaches the device is a core decision, so it happens here, once, for every
  # agent, rather than being re-implemented (or forgotten) per adapter.
  name="$(printf '%s' "$name" | av_clean_speech)"
  project="$(printf '%s' "$project" | av_clean_speech)"

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
      # RULING (I5): background_done fires roughly every 30s per session in
      # production. Without a text fallback chain, .agent_type is empty on
      # every real payload, so this used to speak a content-free sentence
      # every cooldown window, forever. An announcement that says nothing is
      # noise — stay silent and log why instead of speaking it.
      if [ -z "$text" ]; then
        av_log "$agent" "$session" "silent (background_done with no content)"
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
