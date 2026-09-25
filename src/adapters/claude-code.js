// Translates Claude Code hook payloads into canonical events. Pure: it reads
// the payload, returns one event, and keeps no state. Everything it knows about
// Claude Code — hook names, field names, where the session title hides — is here.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { str, projectOf } from './common.js';

export const name = 'claude-code';

export const hooks = [
  { event: 'UserPromptSubmit', sub: 'start', timeout: 5 },
  { event: 'Stop', sub: 'stop', async: true, timeout: 20 },
  { event: 'SubagentStop', sub: 'task', async: true, timeout: 20 },
  { event: 'TaskCompleted', sub: 'task', async: true, timeout: 20 },
  { event: 'Notification', sub: 'notification', async: true, timeout: 20 },
];

export const notes = [];

export function configFile(env = process.env, home = homedir()) {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json');
}

export const detect = (env = process.env, home = homedir()) => existsSync(dirname(configFile(env, home)));

export const hookReply = () => '';

// Claude Code writes an AI-generated title into the transcript as
// {"type":"ai-title","aiTitle":"..."} and rewrites it as the topic shifts.
// Read from the end: the newest one wins.
export function sessionName(transcriptPath) {
  if (!transcriptPath) return '';
  let text;
  try { text = readFileSync(transcriptPath, 'utf8'); } catch { return ''; }
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"type":"ai-title"')) continue;
    try {
      return str(JSON.parse(lines[i]).aiTitle).replace(/[_-]+/g, ' ');
    } catch {
      return '';
    }
  }
  return '';
}

// SubagentStop / TaskCompleted rarely fill agent_type, so try each field in
// turn; the core decides what to do when all are empty.
const taskText = (p) => str(p.agent_type) || str(p.subagent_type) || str(p.description) || str(p.task_description);

const MAPPING = {
  start: ['turn_start', (p) => str(p.prompt)],
  stop: ['task_done', () => ''],
  task: ['background_done', taskText],
  notification: ['needs_input', (p) => str(p.message)],
};

export function translate(sub, payload, home = homedir()) {
  if (!Object.hasOwn(MAPPING, sub)) return null;
  const p = payload && typeof payload === 'object' ? payload : {};
  const [type, text] = MAPPING[sub];
  return {
    type,
    agent: name,
    session_id: str(p.session_id),
    session_name: sessionName(str(p.transcript_path)),
    project: projectOf(p.cwd, home),
    text: text(p),
  };
}
