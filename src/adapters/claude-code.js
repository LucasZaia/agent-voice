// Translates Claude Code hook payloads into canonical events. Pure: it reads
// the payload, returns one event, and keeps no state. Everything it knows about
// Claude Code — hook names, field names, where the session title hides — is here.
import { openSync, readSync, fstatSync, closeSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { str, projectOf } from './common.js';

export const name = 'claude-code';

export const hooks = [
  { event: 'UserPromptSubmit', sub: 'start', timeout: 5 },
  { event: 'Stop', sub: 'stop', async: true, timeout: 60 },
  { event: 'SubagentStop', sub: 'task', async: true, timeout: 60 },
  { event: 'TaskCompleted', sub: 'task', async: true, timeout: 60 },
  { event: 'Notification', sub: 'notification', async: true, timeout: 60 },
];

export const notes = [];

export function configFile(env = process.env, home = homedir()) {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json');
}

export const detect = (env = process.env, home = homedir()) => existsSync(dirname(configFile(env, home)));

export const hookReply = () => '';

// Claude Code writes an AI-generated title into the transcript as
// {"type":"ai-title","aiTitle":"..."} and rewrites it as the topic shifts.
// The newest one wins, so the file is read backwards in chunks: transcripts
// grow to many megabytes and the title is usually near the end.
function titleOf(line) {
  if (!line.includes('"type":"ai-title"')) return null;
  try {
    return str(JSON.parse(line).aiTitle).replace(/[_-]+/g, ' ');
  } catch {
    return '';
  }
}

export function sessionName(transcriptPath, chunkSize = 64 * 1024) {
  if (!transcriptPath) return '';
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    let pos = fstatSync(fd).size;
    // Pieces of the line being assembled, oldest first: everything after the
    // newest newline not yet consumed. Joined once per line, so one huge line
    // (a large tool result) is not copied again for every chunk.
    let parts = [];
    while (pos > 0) {
      const size = Math.min(chunkSize, pos);
      pos -= size;
      const chunk = Buffer.alloc(size);
      readSync(fd, chunk, 0, size, pos);
      // Splitting on the newline byte keeps multi-byte UTF-8 characters whole.
      let end = size;
      for (let nl = chunk.lastIndexOf(10, end - 1); nl !== -1; nl = end > 0 ? chunk.lastIndexOf(10, end - 1) : -1) {
        const title = titleOf(Buffer.concat([chunk.subarray(nl + 1, end), ...parts]).toString('utf8'));
        if (title !== null) return title;
        parts = [];
        end = nl;
      }
      parts.unshift(chunk.subarray(0, end));
    }
    return titleOf(Buffer.concat(parts).toString('utf8')) ?? '';
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// SubagentStop / TaskCompleted rarely fill agent_type, so try each field in
// turn; the core decides what to do when all are empty.
const taskText = (p) => str(p.agent_type) || str(p.subagent_type) || str(p.description) || str(p.task_description);

// Claude Code submits some turns itself — a background task finishing arrives as
// a <task-notification> "prompt". Those blocks are not what the user asked for.
const SYSTEM_BLOCKS = /<(task-notification|system-reminder)>[\s\S]*?<\/\1>/g;
const requestText = (p) => str(p.prompt).replace(SYSTEM_BLOCKS, '').trim();

const MAPPING = {
  start: ['turn_start', requestText],
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
