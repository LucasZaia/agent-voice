// Everything that differs between macOS, Windows and Linux lives here.
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';

export function configDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.AV_CONFIG_DIR) return env.AV_CONFIG_DIR;
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'agent-voice');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'agent-voice');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'agent-voice');
}

export function stateDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.AV_STATE_DIR) return env.AV_STATE_DIR;
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'agent-voice');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'agent-voice', 'state');
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'agent-voice');
}

export function findOnPath(cmd, env = process.env, platform = process.platform) {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      // Windows file lookup is case-insensitive; lower-case keeps the result predictable.
      const candidate = join(dir, cmd + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
