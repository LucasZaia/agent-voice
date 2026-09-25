// Everything that differs between macOS, Windows and Linux lives here.
import { homedir } from 'node:os';
import path, { join } from 'node:path';
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

// Windows environment names are case-insensitive, but a copied env object
// ({ ...process.env }) is not: PATH may arrive as "Path".
export function envValue(env, name, platform = process.platform) {
  if (env[name] !== undefined || platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

// Where the OS would find `cmd`. On Windows this follows cmd.exe: a name that
// already carries a PATHEXT extension is taken as is, otherwise each PATHEXT
// extension is tried — so npm's extensionless sh script never wins over its
// .cmd twin. A name containing a separator is checked where it points.
export function findOnPath(cmd, env = process.env, platform = process.platform, exists = existsSync) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const name = String(cmd ?? '');
  if (!name) return null;
  let exts = [''];
  if (win) {
    const pathext = (envValue(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase());
    // Windows file lookup is case-insensitive; lower-case keeps the result predictable.
    if (!pathext.includes(p.extname(name).toLowerCase())) exts = pathext;
  }
  const hasDir = win ? /[\\/]/.test(name) : name.includes('/');
  const dirs = hasDir
    ? ['']
    : (envValue(env, 'PATH', platform) ?? '').split(p.delimiter).map((d) => d.replace(/^"(.*)"$/, '$1')).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = dir ? p.join(dir, name + ext) : name + ext;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}
