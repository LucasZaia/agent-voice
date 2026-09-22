#!/usr/bin/env bash
# Speaks the sentence on the Echo, through the Home Assistant repo's falar.sh.
# falar.sh stays there on purpose: it is the Home Assistant interface, and the
# daily-priorities cron already depends on it.
#
# Runs as a CHILD PROCESS of av_speak (lib/core.sh), under `set -u`. AV_* vars
# must reach us through the environment, not just as shell assignments in
# config.sh — that's why config.sh exports them. We still guard the reference
# with ${AV_SPEAK_CMD:-} instead of a bare $AV_SPEAK_CMD: if that export is
# ever dropped again, this prints a clear reason on stderr instead of dying
# with the opaque "AV_SPEAK_CMD: unbound variable" that let this ship silently
# broken once already.
#
# Whatever we print on stderr here is captured by av_speak and folded into the
# "FAILED via alexa" log line, so a quiet hook and a dead one stay
# distinguishable.
set -uo pipefail

sentence="$(cat)"
if [ -z "$sentence" ]; then
  printf 'empty sentence\n' >&2
  exit 1
fi

if [ -z "${AV_SPEAK_CMD:-}" ]; then
  printf 'AV_SPEAK_CMD not set (config.sh export missing?)\n' >&2
  exit 1
fi

if [ ! -x "$AV_SPEAK_CMD" ]; then
  printf 'AV_SPEAK_CMD not executable: %s\n' "$AV_SPEAK_CMD" >&2
  exit 1
fi

err="$("$AV_SPEAK_CMD" -a "$sentence" 2>&1 >/dev/null)"
rc=$?
if [ "$rc" -ne 0 ]; then
  printf '%s\n' "${err:-falar.sh exited $rc with no output}" >&2
  exit 1
fi
exit 0
