#!/usr/bin/env bash
# Stands in for falar.sh during tests: records instead of speaking.
shift 2>/dev/null          # discard the -a flag
printf '%s\n' "$*" >> "${AV_SPOKEN:-/dev/null}"
