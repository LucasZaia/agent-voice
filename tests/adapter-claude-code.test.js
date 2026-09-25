import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cc from '../src/adapters/claude-code.js';
import { projectOf } from '../src/adapters/common.js';
import { ADAPTERS } from '../src/adapters/index.js';

const home = join('/', 'home', 'u');
const payload = { session_id: '04c02385', cwd: join(home, 'softwares', 'home-assistant'), prompt: 'criar o compose', transcript_path: '/nao/existe.jsonl' };

test('start maps to turn_start carrying agent, session, project and prompt', () => {
  assert.deepEqual(cc.translate('start', payload, home), {
    type: 'turn_start', agent: 'claude-code', session_id: '04c02385',
    session_name: '', project: 'home-assistant', text: 'criar o compose',
  });
});

test('subcommand mapping', () => {
  assert.equal(cc.translate('stop', payload, home).type, 'task_done');
  assert.equal(cc.translate('stop', payload, home).text, '');
  assert.equal(cc.translate('task', payload, home).type, 'background_done');
  assert.equal(cc.translate('notification', { ...payload, message: 'permission needed' }, home).text, 'permission needed');
  assert.equal(cc.translate('notification', payload, home).type, 'needs_input');
  assert.equal(cc.translate('bogus', payload, home), null);
});

test('task text falls back agent_type → subagent_type → description → task_description', () => {
  const t = (p) => cc.translate('task', { session_id: 's', cwd: '/a/b', ...p }, home).text;
  assert.equal(t({ agent_type: 'reviewer', subagent_type: 'x', description: 'y', task_description: 'z' }), 'reviewer');
  assert.equal(t({ subagent_type: 'code-reviewer', description: 'y' }), 'code-reviewer');
  assert.equal(t({ description: 'reviewing the diff', task_description: 'z' }), 'reviewing the diff');
  assert.equal(t({ task_description: 'run the tests' }), 'run the tests');
  assert.equal(t({}), '');
});

test('home directory is not a project; trailing separators are ignored', () => {
  assert.equal(projectOf(home, home), '');
  assert.equal(projectOf(`${home}/`, home), '');
  assert.equal(projectOf('/a/proj/', home), 'proj');
  assert.equal(projectOf('C:\\Users\\u\\code\\proj', 'C:\\Users\\u'), 'proj');
  assert.equal(projectOf(undefined, home), '');
});

test('garbage payloads never throw', () => {
  assert.equal(cc.translate('start', null, home).session_id, '');
  assert.equal(cc.translate('start', 'lixo', home).text, '');
  assert.equal(cc.translate('start', { session_id: 42, prompt: {} }, home).session_id, '');
});

test('session name is the newest ai-title in the transcript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-tr-'));
  const tr = join(dir, 'fake.jsonl');
  writeFileSync(tr, [
    '{"type":"ai-title","aiTitle":"Older title"}',
    '{"type":"user","message":"x"}',
    '{"type":"ai-title","aiTitle":"Home-assistant repo"}',
    '',
  ].join('\n'));
  assert.equal(cc.sessionName(tr), 'Home assistant repo');
  assert.equal(cc.translate('start', { ...payload, transcript_path: tr }, home).session_name, 'Home assistant repo');
});

test('session name survives CRLF transcripts (Windows)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-tr-'));
  const tr = join(dir, 'crlf.jsonl');
  writeFileSync(tr, '{"type":"user"}\r\n{"type":"ai-title","aiTitle":"Titulo_windows"}\r\n');
  assert.equal(cc.sessionName(tr), 'Titulo windows');
});

test('missing or corrupt transcript leaves the name empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-tr-'));
  const tr = join(dir, 'bad.jsonl');
  writeFileSync(tr, '{"type":"ai-title", broken\n');
  assert.equal(cc.sessionName(tr), '');
  assert.equal(cc.sessionName('/nao/existe.jsonl'), '');
  assert.equal(cc.sessionName(''), '');
});

test('config file honours CLAUDE_CONFIG_DIR and detect() checks its directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-cc-'));
  assert.equal(cc.configFile({}, home), join(home, '.claude', 'settings.json'));
  assert.equal(cc.configFile({ CLAUDE_CONFIG_DIR: dir }, home), join(dir, 'settings.json'));
  assert.equal(cc.detect({ CLAUDE_CONFIG_DIR: join(dir, 'nope') }, home), false);
  mkdirSync(join(dir, 'yes'));
  assert.equal(cc.detect({ CLAUDE_CONFIG_DIR: join(dir, 'yes') }, home), true);
});

test('hooks match the README wiring and nothing is written back to Claude Code', () => {
  assert.deepEqual(cc.hooks.map((h) => `${h.event}:${h.sub}`), [
    'UserPromptSubmit:start', 'Stop:stop', 'SubagentStop:task', 'TaskCompleted:task', 'Notification:notification',
  ]);
  assert.equal(cc.hooks[0].async, undefined);
  assert.equal(cc.hooks[0].timeout, 5);
  // Room for three outputs at 15s each, so a FAILED line is logged before the agent kills the hook.
  for (const h of cc.hooks.slice(1)) assert.deepEqual([h.async, h.timeout], [true, 60], h.event);
  assert.equal(cc.hookReply('stop'), '');
  assert.equal(ADAPTERS['claude-code'], cc);
});

test('a large transcript is read from the end; the newest title wins across chunk boundaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-tr-'));
  const tr = join(dir, 'big.jsonl');
  const filler = `${JSON.stringify({ type: 'user', message: 'x'.repeat(1000) })}\n`;
  writeFileSync(tr, '{"type":"ai-title","aiTitle":"Old"}\n' + filler.repeat(5000)
    + '{"type":"ai-title","aiTitle":"Configuração_do_ção"}\r\n' + filler.repeat(3));
  assert.equal(cc.sessionName(tr), 'Configuração do ção');
  for (const chunk of [1, 7, 64]) assert.equal(cc.sessionName(tr, chunk), 'Configuração do ção', `chunk ${chunk}`);
  const first = join(dir, 'first.jsonl');
  writeFileSync(first, '{"type":"ai-title","aiTitle":"Só no começo"}\n' + filler.repeat(200));
  assert.equal(cc.sessionName(first, 4096), 'Só no começo');
});

test('windows: the home dir is recognised whatever the case or separators', () => {
  assert.equal(projectOf('c:/users/U/', 'C:\\Users\\u', 'win32'), '');
  assert.equal(projectOf('C:\\Users\\u\\Code\\Proj', 'C:\\Users\\u', 'win32'), 'Proj');
  assert.equal(projectOf('/home/U', '/home/u', 'linux'), 'U');
});
