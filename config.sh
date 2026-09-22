# Tunables. Every one can be overridden from the environment, which is how the
# tests stay off the real state directory and off the real Echo.
#
# Every AV_* var is exported. outputs/alexa.sh (and any future output) runs as
# a CHILD PROCESS under `set -u`: a plain assignment here is invisible to it
# and it dies on "AV_SPEAK_CMD: unbound variable" — silently, since bin/notify
# always exits 0. That bug shipped to production because the test suite
# exports AV_STATE_DIR and AV_SPEAK_CMD itself, masking the very thing this
# file must do. AV_ROOT is exported by bin/notify before this file is sourced;
# it is re-exported here too so config.sh is self-sufficient on its own.
AV_ROOT="${AV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export AV_ROOT

AV_MIN_SECONDS="${AV_MIN_SECONDS:-30}"          # below this, a turn is not worth announcing
AV_COOLDOWN_SECONDS="${AV_COOLDOWN_SECONDS:-120}" # minimum gap between background announcements
AV_MAX_SPEECH_CHARS="${AV_MAX_SPEECH_CHARS:-90}"  # cut for the quoted request
AV_STATE_DIR="${AV_STATE_DIR:-$HOME/.local/state/agent-voice}"
AV_OUTPUTS="${AV_OUTPUTS:-alexa}"               # space-separated names of outputs/<name>.sh
AV_SPEAK_CMD="${AV_SPEAK_CMD:-$HOME/softwares/home-assistant/falar.sh}"
export AV_MIN_SECONDS AV_COOLDOWN_SECONDS AV_MAX_SPEECH_CHARS AV_STATE_DIR AV_OUTPUTS AV_SPEAK_CMD
