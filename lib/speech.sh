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
