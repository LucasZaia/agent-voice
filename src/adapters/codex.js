// Translates Codex CLI hook payloads into canonical events. Codex hooks share
// Claude Code's shape; the differences are the event names, session names living
// in Codex's session index, and Stop wanting JSON back.
import { existsSync, readFileSync } from 'node:fs';
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

export const sessionIndexFile = (env = process.env, home = homedir()) => join(dirname(configFile(env, home)), 'session_index.jsonl');

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

export function sessionName(sessionId, env = process.env, home = homedir()) {
  const id = str(sessionId);
  if (!id) return '';
  try {
    const lines = readFileSync(sessionIndexFile(env, home), 'utf8').split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes(id)) continue;
      try {
        const row = JSON.parse(lines[i]);
        if (str(row.id) === id) return str(row.thread_name);
      } catch {
        return '';
      }
    }
  } catch {
    return '';
  }
  return '';
}

export function translate(sub, payload, home = homedir(), env = process.env) {
  if (!Object.hasOwn(MAPPING, sub)) return null;
  const p = payload && typeof payload === 'object' ? payload : {};
  const [type, text] = MAPPING[sub];
  const sessionId = str(p.session_id);
  return {
    type,
    agent: name,
    session_id: sessionId,
    session_name: str(p.session_name) || str(p.thread_name) || sessionName(sessionId, env, home),
    project: projectOf(p.cwd, home),
    text: text(p),
  };
}
