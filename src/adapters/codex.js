// Translates Codex CLI hook payloads into canonical events. Codex hooks share
// Claude Code's shape; the differences are the event names, no ai-title in the
// transcript (Codex calls its format unstable), and Stop wanting JSON back.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { str, projectOf } from './common.js';

export const name = 'codex';

export const hooks = [
  { event: 'UserPromptSubmit', sub: 'start', timeout: 5 },
  { event: 'Stop', sub: 'stop', async: true, timeout: 60 },
  { event: 'PermissionRequest', sub: 'permission', async: true, timeout: 60 },
];

export const notes = ['Codex skips hooks it has not trusted yet: open Codex and run /hooks to review and trust them.'];

export function configFile(env = process.env, home = homedir()) {
  return join(env.CODEX_HOME || join(home, '.codex'), 'hooks.json');
}

export const detect = (env = process.env, home = homedir()) => existsSync(dirname(configFile(env, home)));

// Codex treats non-JSON stdout from a Stop hook as invalid.
export const hookReply = (sub) => (sub === 'stop' ? '{}' : '');

// Worded like Claude Code's notice so the core's translation applies:
// "..., para usar o Bash."
const permissionText = (p) => (str(p.tool_name) ? `needs your permission to use ${str(p.tool_name)}` : 'needs your permission');

const MAPPING = {
  start: ['turn_start', (p) => str(p.prompt)],
  stop: ['task_done', () => ''],
  permission: ['needs_input', permissionText],
};

export function translate(sub, payload, home = homedir()) {
  if (!Object.hasOwn(MAPPING, sub)) return null;
  const p = payload && typeof payload === 'object' ? payload : {};
  const [type, text] = MAPPING[sub];
  return { type, agent: name, session_id: str(p.session_id), session_name: '', project: projectOf(p.cwd, home), text: text(p) };
}
