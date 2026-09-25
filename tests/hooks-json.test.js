import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as h from '../src/adapters/hooks-json.js';
import { hooks as ccHooks } from '../src/adapters/claude-code.js';

const tmpFile = (content) => {
  const dir = mkdtempSync(join(tmpdir(), 'av-hooks-'));
  const file = join(dir, 'settings.json');
  if (content !== undefined) writeFileSync(file, content);
  return { dir, file };
};
const foreign = { type: 'command', command: 'notify-send done' };
const at = new Date(2026, 8, 25, 10, 0, 0);

test('isOurs recognises new and legacy commands, and nothing else', () => {
  assert.equal(h.isOurs('agent-voice notify claude-code stop', 'claude-code'), true);
  assert.equal(h.isOurs('node /x/agent-voice/bin/agent-voice.js notify claude-code stop', 'claude-code'), true);
  assert.equal(h.isOurs('/home/u/softwares/agent-voice/bin/notify claude-code stop', 'claude-code'), true);
  assert.equal(h.isOurs('agent-voice notify codex stop', 'claude-code'), false);
  assert.equal(h.isOurs('notify-send done', 'claude-code'), false);
  assert.equal(h.isOurs(undefined, 'claude-code'), false);
  assert.equal(h.isLegacy('/home/u/softwares/agent-voice/bin/notify claude-code stop'), true);
  assert.equal(h.isLegacy('agent-voice notify claude-code stop'), false);
});

test('missing file is created with our hooks', () => {
  const { file } = tmpFile();
  const r = h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  assert.deepEqual(r, { changed: true, backup: null });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(s.hooks.Stop, [{ hooks: [{ type: 'command', command: 'agent-voice notify claude-code stop', async: true, timeout: 60 }] }]);
  assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'agent-voice notify claude-code start', timeout: 5 }] }]);
  assert.equal(h.hookStatus(s, 'claude-code', ccHooks), 'connected');
});

test('connect is idempotent: the second run changes nothing', () => {
  const { file } = tmpFile(JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [foreign] }] } }));
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  const first = readFileSync(file, 'utf8');
  const r = h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  assert.equal(r.changed, false);
  assert.equal(readFileSync(file, 'utf8'), first);
});

test('foreign hooks and other settings are preserved, and a backup is made', () => {
  const { dir, file } = tmpFile(JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [foreign] }] } }));
  const r = h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.hooks.Stop[0], { hooks: [foreign] });
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(r.backup, `${file}.bak-20260925-100000`);
  assert.ok(existsSync(r.backup));
  assert.deepEqual(readdirSync(dir).sort(), ['settings.json', 'settings.json.bak-20260925-100000']);
});

test('legacy bash hooks are replaced, not doubled', () => {
  const legacy = { type: 'command', command: '/home/u/softwares/agent-voice/bin/notify claude-code stop', async: true, timeout: 20 };
  const { file } = tmpFile(JSON.stringify({ hooks: { Stop: [{ hooks: [legacy] }] } }));
  assert.equal(h.fileStatus(file, 'claude-code', ccHooks), 'legacy');
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.Stop.length, 1);
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'agent-voice notify claude-code stop');
});

test('a group mixing ours and foreign keeps the foreign one', () => {
  const mixed = { hooks: { Stop: [{ matcher: '', hooks: [foreign, { type: 'command', command: 'agent-voice notify claude-code stop' }] }] } };
  const { settings, removed } = h.removeHooks(mixed, 'claude-code');
  assert.equal(removed, 1);
  assert.deepEqual(settings.hooks.Stop, [{ matcher: '', hooks: [foreign] }]);
});

test('disconnect removes only ours and drops empty events', () => {
  const { file } = tmpFile(JSON.stringify({ hooks: { Stop: [{ hooks: [foreign] }] } }));
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  h.disconnectFile(file, 'claude-code', { now: at });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { hooks: { Stop: [{ hooks: [foreign] }] } });
});

test('disconnect on a file without our hooks does not rewrite it', () => {
  const original = '{"model":    "opus"}';
  const { file } = tmpFile(original);
  assert.deepEqual(h.disconnectFile(file, 'claude-code', { now: at }), { changed: false, backup: null });
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('disconnect with no hooks left removes the hooks key entirely', () => {
  const { file } = tmpFile();
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  h.disconnectFile(file, 'claude-code', { now: at });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
});

test('invalid JSON aborts and writes nothing', () => {
  const { dir, file } = tmpFile('{ "hooks": ');
  assert.throws(() => h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice' }), /invalid JSON.*nothing was written/);
  assert.equal(readFileSync(file, 'utf8'), '{ "hooks": ');
  assert.deepEqual(readdirSync(dir), ['settings.json']);
});

test('unexpected hooks shapes abort and write nothing', () => {
  for (const bad of ['{"hooks": []}', '{"hooks": {"Stop": {}}}', '[]', '"x"']) {
    const { file } = tmpFile(bad);
    assert.throws(() => h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice' }), /nothing was written/, bad);
    assert.equal(readFileSync(file, 'utf8'), bad);
  }
});

test('an empty file is treated as empty settings', () => {
  const { file } = tmpFile('');
  h.connectFile(file, 'claude-code', ccHooks, { command: 'agent-voice', now: at });
  assert.equal(h.fileStatus(file, 'claude-code', ccHooks), 'connected');
});

test('status: partial and not connected', () => {
  const partial = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'agent-voice notify claude-code stop' }] }] } };
  assert.equal(h.hookStatus(partial, 'claude-code', ccHooks), 'partially connected');
  assert.equal(h.hookStatus({}, 'claude-code', ccHooks), 'not connected');
  const { file } = tmpFile('{ broken');
  assert.match(h.fileStatus(file, 'claude-code', ccHooks), /^unreadable/);
});

test('hookCommand honours AV_HOOK_COMMAND', () => {
  assert.equal(h.hookCommand({}), 'agent-voice');
  assert.equal(h.hookCommand({ AV_HOOK_COMMAND: 'node /x/bin/agent-voice.js' }), 'node /x/bin/agent-voice.js');
});
