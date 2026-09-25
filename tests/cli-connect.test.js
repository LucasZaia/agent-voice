import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, scriptedPrompter, collector } from './helpers.js';
import { runConnect, runDisconnect } from '../src/cli/connect.js';

const settings = (sb) => JSON.parse(readFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'));

test('connect shows the hooks, asks, and writes them', async () => {
  const sb = sandbox();
  const c = collector();
  const prompt = scriptedPrompter([true]);
  assert.equal(await runConnect(['claude-code'], { env: sb.env, out: c.out, prompt }), 0);
  assert.match(c.text(), /UserPromptSubmit\s+→ agent-voice notify claude-code start/);
  assert.equal(settings(sb).hooks.Stop[0].hooks[0].command, 'agent-voice notify claude-code stop');
});

test('declining leaves the file untouched', async () => {
  const sb = sandbox();
  const c = collector();
  await runConnect(['claude-code'], { env: sb.env, out: c.out, prompt: scriptedPrompter([false]) });
  assert.match(c.text(), /Nothing changed/);
  assert.throws(() => settings(sb), /ENOENT/);
});

test('--yes skips the question; AV_HOOK_COMMAND is used in the hooks', async () => {
  const sb = sandbox();
  const env = { ...sb.env, AV_HOOK_COMMAND: 'node /x/agent-voice/bin/agent-voice.js' };
  await runConnect(['claude-code', '--yes'], { env, out: () => {}, prompt: scriptedPrompter([]) });
  assert.equal(settings(sb).hooks.Stop[0].hooks[0].command, 'node /x/agent-voice/bin/agent-voice.js notify claude-code stop');
});

test('codex connect writes hooks.json and prints the trust note', async () => {
  const sb = sandbox();
  const c = collector();
  await runConnect(['codex', '--yes'], { env: sb.env, out: c.out, prompt: scriptedPrompter([]) });
  const hooks = JSON.parse(readFileSync(join(sb.env.CODEX_HOME, 'hooks.json'), 'utf8')).hooks;
  assert.equal(hooks.PermissionRequest[0].hooks[0].command, 'agent-voice notify codex permission');
  assert.match(c.text(), /run \/hooks/);
});

test('running connect twice reports already connected', async () => {
  const sb = sandbox();
  const c = collector();
  const io = { env: sb.env, out: c.out, prompt: scriptedPrompter([]) };
  await runConnect(['claude-code', '--yes'], io);
  await runConnect(['claude-code', '--yes'], io);
  assert.match(c.text(), /already connected; nothing changed/);
});

test('a broken settings.json is reported and left alone', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  writeFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), '{ nope');
  await assert.rejects(runConnect(['claude-code', '--yes'], { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) }), /invalid JSON/);
});

test('warns when agent-voice is not on PATH', async () => {
  const sb = sandbox();
  const c = collector();
  await runConnect(['claude-code', '--yes'], { env: { ...sb.env, PATH: '' }, out: c.out, prompt: scriptedPrompter([]) });
  assert.match(c.text(), /not on your PATH/);
});

test('disconnect removes the hooks; unknown agent is an error', async () => {
  const sb = sandbox();
  const io = { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) };
  await runConnect(['claude-code', '--yes'], io);
  await runDisconnect(['claude-code'], io);
  assert.deepEqual(settings(sb), {});
  await assert.rejects(runConnect(['aider'], io), /unknown agent "aider" \(available: claude-code, codex\)/);
});
