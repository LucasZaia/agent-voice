import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDER = join(ROOT, 'tests', 'fixtures', 'record-speech.mjs');

// A throwaway world: config, state, Claude Code and Codex dirs all under one
// temp dir, and no AV_* tunables inherited from the developer's shell.
export function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'av-'));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('AV_')) delete env[k];
  Object.assign(env, {
    HOME: join(dir, 'home'),
    USERPROFILE: join(dir, 'home'),
    AV_CONFIG_DIR: join(dir, 'config'),
    AV_STATE_DIR: join(dir, 'state'),
    CLAUDE_CONFIG_DIR: join(dir, 'claude'),
    CODEX_HOME: join(dir, 'codex'),
  });
  const spoken = join(dir, 'spoken.txt');
  const spokenLines = () => (existsSync(spoken) ? readFileSync(spoken, 'utf8').split('\n').filter(Boolean) : []);
  return { dir, env, spoken, spokenLines };
}

// Stands in for readline in tests: answers are consumed in order.
// ask → string ('' means "accept default"), confirm → boolean, choose → index.
export function scriptedPrompter(answers) {
  const queue = [...answers];
  const asked = [];
  const next = (q) => {
    asked.push(q);
    if (queue.length === 0) throw new Error(`unexpected prompt: ${q}`);
    return queue.shift();
  };
  return {
    asked,
    async ask(q, def = '') { const a = next(q); return a === '' ? def : a; },
    async confirm(q, def = true) { const a = next(q); return a === '' ? def : a; },
    async choose(q, options, def = 0) { const a = next(q); return a === '' ? def : a; },
    close() {},
  };
}

export function collector() {
  const lines = [];
  return { lines, out: (s) => lines.push(String(s)), text: () => lines.join('\n') };
}
