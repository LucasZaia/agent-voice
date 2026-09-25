import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { sandbox, ROOT, RECORDER } from './helpers.js';
import { writeOutputInstance, saveConfig } from '../src/config.js';
import { createState } from '../src/core/state.js';
import { readStdin, runNotify } from '../src/cli/notify.js';

const BIN = join(ROOT, 'bin', 'agent-voice.js');
const notify = (sb, args, input, extraEnv = {}) =>
  spawnSync(process.execPath, [BIN, 'notify', ...args], { input, env: { ...sb.env, ...extraEnv }, encoding: 'utf8' });
const logOf = (sb) => readFileSync(join(sb.env.AV_STATE_DIR, 'events.log'), 'utf8');
const recorderOutput = (sb) => {
  writeOutputInstance('rec', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken, '{text}'] }, sb.env);
  saveConfig({ outputs: ['rec'] }, sb.env);
};
const backdate = (sb, agent, session, s) =>
  writeFileSync(`${createState(sb.env.AV_STATE_DIR).path(agent, session)}.start`, String(Math.floor(Date.now() / 1000) - s));

test('end to end: a long Claude Code turn is spoken through a real output', () => {
  const sb = sandbox();
  recorderOutput(sb);
  assert.equal(notify(sb, ['claude-code', 'start'], JSON.stringify({ session_id: 'e1', cwd: '/a/proj', prompt: 'tarefa longa' })).status, 0);
  backdate(sb, 'claude-code', 'e1', 240);
  const r = notify(sb, ['claude-code', 'stop'], JSON.stringify({ session_id: 'e1', cwd: '/a/proj' }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(sb.spokenLines().at(-1), /^Claude Code terminou .*tarefa longa\.$/);
  assert.match(logOf(sb), /spoke via rec: Claude Code terminou/);
});

test('codex Stop prints {} for Codex and still exits 0', () => {
  const sb = sandbox();
  const r = notify(sb, ['codex', 'stop'], JSON.stringify({ session_id: 'x', cwd: '/a' }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{}');
});

test('unknown agent, garbage, no arguments: all exit 0 and log', () => {
  const sb = sandbox();
  assert.equal(notify(sb, ['nao-existe', 'start'], '{}').status, 0);
  assert.equal(notify(sb, ['claude-code', 'start'], 'lixo').status, 0);
  assert.equal(notify(sb, [], '').status, 0);
  const text = logOf(sb);
  assert.match(text, /no adapter for nao-existe/);
  assert.match(text, /ignored: incomplete event/);
  assert.match(text, /ignored: usage is notify <agent> <subcommand>/);
});

test('a failing output exits 0 and its reason reaches the log', () => {
  const sb = sandbox();
  recorderOutput(sb);
  notify(sb, ['claude-code', 'notification'], JSON.stringify({ session_id: 'f2', cwd: '/a', message: 'x' }), { STUB_FAIL: 'token missing' });
  assert.match(logOf(sb), /FAILED via rec \(token missing\)/);
});

test('an enabled output with no instance logs no such output', () => {
  const sb = sandbox();
  saveConfig({ outputs: ['ghost'] }, sb.env);
  notify(sb, ['claude-code', 'notification'], JSON.stringify({ session_id: 'g', cwd: '/a' }));
  assert.match(logOf(sb), /no such output: ghost/);
});

test('a corrupt config.json still exits 0 and logs why', () => {
  const sb = sandbox();
  mkdirSync(sb.env.AV_CONFIG_DIR, { recursive: true });
  writeFileSync(join(sb.env.AV_CONFIG_DIR, 'config.json'), '{ nope');
  const r = notify(sb, ['claude-code', 'start'], JSON.stringify({ session_id: 'c', cwd: '/a', prompt: 'x' }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(logOf(sb), /error: .*config\.json: invalid JSON/);
});

test('readStdin gives up on a stream that never ends', async () => {
  const stream = new PassThrough();
  stream.write('{"partial":');
  const started = Date.now();
  assert.equal(await readStdin(stream, 100), '{"partial":');
  assert.ok(Date.now() - started < 1000);
});

test('readStdin returns empty for a TTY', async () => {
  assert.equal(await readStdin({ isTTY: true }), '');
});

test('runNotify swallows everything, even a throwing writer', async () => {
  const sb = sandbox();
  const code = await runNotify(['codex', 'stop'], { input: '{}', env: sb.env, write: () => { throw new Error('EPIPE'); } });
  assert.equal(code, 0);
  assert.match(logOf(sb), /error: EPIPE/);
});
