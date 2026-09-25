import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, ROOT } from './helpers.js';
import { parseWrapArgs, runWrap } from '../src/cli/wrap.js';

const recorder = () => {
  const events = [];
  return { events, notify: async (e) => { events.push(e); } };
};

test('argument parsing', () => {
  assert.deepEqual(parseWrapArgs(['--', 'npm', 'test']), { name: '', command: ['npm', 'test'] });
  assert.deepEqual(parseWrapArgs(['--name', 'build', '--', 'make']), { name: 'build', command: ['make'] });
  assert.throws(() => parseWrapArgs(['npm', 'test']), /unknown option npm/);
  assert.throws(() => parseWrapArgs(['--']), /usage/);
  assert.throws(() => parseWrapArgs([]), /usage/);
});

test('emits turn_start then task_done and returns the child exit code', async () => {
  const r = recorder();
  const code = await runWrap(['--', process.execPath, '-e', 'process.exit(3)'], { notify: r.notify, pid: 42, cwd: join('/', 'w', 'proj') });
  assert.equal(code, 3);
  assert.deepEqual(r.events.map((e) => e.type), ['turn_start', 'task_done']);
  assert.equal(r.events[0].session_id, 'wrap-42');
  assert.equal(r.events[0].agent, 'wrap');
  assert.equal(r.events[0].project, 'proj');
  assert.match(r.events[0].text, /process\.exit\(3\)/);
});

test('--name becomes the spoken session name', async () => {
  const r = recorder();
  await runWrap(['--name', 'o build', '--', process.execPath, '-e', ''], { notify: r.notify });
  assert.equal(r.events[0].session_name, 'o build');
});

test('a missing command returns 127, says so, and still closes the turn', async () => {
  const r = recorder();
  const errors = [];
  const code = await runWrap(['--', 'definitely-not-a-command-av'], { notify: r.notify, err: (s) => errors.push(s) });
  assert.equal(code, 127);
  assert.deepEqual(errors, ['agent-voice wrap: command not found: definitely-not-a-command-av']);
  assert.deepEqual(r.events.map((e) => e.type), ['turn_start', 'task_done']);
});

test('through the executable: exit code passes through and the short turn is logged silent', () => {
  const sb = sandbox();
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'agent-voice.js'), 'wrap', '--', process.execPath, '-e', 'process.exit(5)'],
    { env: sb.env, encoding: 'utf8' });
  assert.equal(r.status, 5);
  const log = readFileSync(join(sb.env.AV_STATE_DIR, 'events.log'), 'utf8');
  assert.match(log, /wrap\s+wrap-\d+/);
  assert.match(log, /silent \(turn \ds < 30s\)/);
});

test('windows: a missing command returns 127 before anything is spawned', async () => {
  const r = recorder();
  let spawned = false;
  const spawn = () => {
    spawned = true;
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', 1, null)); // what cmd.exe would answer
    return child;
  };
  const code = await runWrap(['--', 'definitely-not-a-command-av'], { notify: r.notify, spawn, platform: 'win32', env: { PATH: '' }, err: () => {} });
  assert.equal(code, 127);
  assert.equal(spawned, false);
  assert.deepEqual(r.events.map((e) => e.type), ['turn_start', 'task_done']);
});

test('the wrapped command never runs through a shell, so its arguments stay literal', async () => {
  const r = recorder();
  const calls = [];
  const spawn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  };
  const code = await runWrap(['--', 'git', 'commit', '-m', 'fix a & b'], { notify: r.notify, spawn, platform: 'linux' });
  assert.equal(code, 0);
  assert.deepEqual(calls[0].args, ['commit', '-m', 'fix a & b']);
  assert.equal(calls[0].options.shell, false);
});
