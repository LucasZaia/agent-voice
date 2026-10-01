import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as codex from '../src/adapters/codex.js';
import { ADAPTERS } from '../src/adapters/index.js';

const home = join('/', 'home', 'u');
const base = { session_id: 'thr-1', cwd: '/w/proj', transcript_path: null, hook_event_name: 'X', model: 'gpt' };

test('UserPromptSubmit → turn_start with the prompt', () => {
  assert.deepEqual(codex.translate('start', { ...base, turn_id: 't1', prompt: 'refatora o parser' }, home), {
    type: 'turn_start', agent: 'codex', session_id: 'thr-1', session_name: '', project: 'proj', text: 'refatora o parser',
  });
});

test('Stop → task_done', () => {
  assert.equal(codex.translate('stop', { ...base, last_assistant_message: 'done' }, home).type, 'task_done');
});

test('PermissionRequest → needs_input phrased so the core translates it', () => {
  assert.equal(codex.translate('permission', { ...base, tool_name: 'Bash' }, home).text, 'needs your permission to use Bash');
  assert.equal(codex.translate('permission', base, home).text, 'needs your permission');
  assert.equal(codex.translate('permission', base, home).type, 'needs_input');
});

test('unknown subcommand and garbage payloads', () => {
  assert.equal(codex.translate('nope', base, home), null);
  assert.equal(codex.translate('start', null, home).session_id, '');
});

test('Stop gets a JSON reply; others get nothing', () => {
  assert.equal(codex.hookReply('stop'), '{}');
  assert.equal(codex.hookReply('start'), '');
  assert.equal(codex.hookReply('permission'), '');
});

test('config file follows CODEX_HOME', () => {
  assert.equal(codex.configFile({}, home), join(home, '.codex', 'hooks.json'));
  assert.equal(codex.configFile({ CODEX_HOME: join('/', 'c') }, home), join('/', 'c', 'hooks.json'));
});

test('session name prefers payload fields', () => {
  assert.equal(codex.translate('start', { ...base, session_name: 'Repo real', thread_name: 'Repo antigo' }, home).session_name, 'Repo real');
  assert.equal(codex.translate('start', { ...base, thread_name: 'Repo real' }, home).session_name, 'Repo real');
});

test('session name is read from Codex session_index.jsonl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-codex-'));
  const codexHome = join(dir, 'codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'session_index.jsonl'), [
    JSON.stringify({ id: 'thr-1', thread_name: 'Nome antigo', updated_at: '2026-09-27T10:00:00Z' }),
    JSON.stringify({ id: 'other', thread_name: 'Outra sessão', updated_at: '2026-09-27T10:01:00Z' }),
    JSON.stringify({ id: 'thr-1', thread_name: 'Nome atual', updated_at: '2026-09-27T10:02:00Z' }),
    '',
  ].join('\n'));
  const env = { CODEX_HOME: codexHome };
  assert.equal(codex.sessionIndexFile(env, home), join(codexHome, 'session_index.jsonl'));
  assert.equal(codex.sessionName('thr-1', env, home), 'Nome atual');
  assert.equal(codex.translate('start', base, home, env).session_name, 'Nome atual');
});

test('missing, corrupt or unrelated Codex session index leaves the name empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-codex-'));
  const codexHome = join(dir, 'codex');
  mkdirSync(codexHome, { recursive: true });
  assert.equal(codex.sessionName('thr-1', { CODEX_HOME: codexHome }, home), '');
  writeFileSync(join(codexHome, 'session_index.jsonl'), '{"id":"thr-1", broken\n{"id":"other","thread_name":"x"}\n');
  assert.equal(codex.sessionName('thr-1', { CODEX_HOME: codexHome }, home), '');
  assert.equal(codex.sessionName('missing', { CODEX_HOME: codexHome }, home), '');
  assert.equal(codex.sessionName('', { CODEX_HOME: codexHome }, home), '');
});

test('hooks and the trust note', () => {
  assert.deepEqual(codex.hooks.map((h) => `${h.event}:${h.sub}`), ['UserPromptSubmit:start', 'Stop:stop', 'PermissionRequest:permission']);
  assert.match(codex.notes.join(' '), /\/hooks/);
  assert.equal(codex.hooks[0].timeout, 5);
  for (const h of codex.hooks.slice(1)) assert.deepEqual([h.async, h.timeout], [true, 60], h.event);
  assert.equal(ADAPTERS.codex, codex);
});
