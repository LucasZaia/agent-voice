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
