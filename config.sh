# Tunables. Every one can be overridden from the environment, which is how the
# tests stay off the real state directory and off the real Echo.
AV_ROOT="${AV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

AV_MIN_SECONDS="${AV_MIN_SECONDS:-60}"          # below this, a turn is not worth announcing
AV_COOLDOWN_SECONDS="${AV_COOLDOWN_SECONDS:-120}" # minimum gap between background announcements
AV_MAX_SPEECH_CHARS="${AV_MAX_SPEECH_CHARS:-90}"  # cut for the quoted request
AV_STATE_DIR="${AV_STATE_DIR:-$HOME/.local/state/agent-voice}"
AV_OUTPUTS="${AV_OUTPUTS:-alexa}"               # space-separated names of outputs/<name>.sh
AV_SPEAK_CMD="${AV_SPEAK_CMD:-$HOME/softwares/home-assistant/falar.sh}"
