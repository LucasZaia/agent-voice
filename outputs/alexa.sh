#!/usr/bin/env bash
# Speaks the sentence on the Echo, through the Home Assistant repo's falar.sh.
# falar.sh stays there on purpose: it is the Home Assistant interface, and the
# daily-priorities cron already depends on it.
set -uo pipefail

sentence="$(cat)"
[ -n "$sentence" ] || exit 1
[ -x "$AV_SPEAK_CMD" ] || exit 1

"$AV_SPEAK_CMD" -a "$sentence" >/dev/null 2>&1
