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
