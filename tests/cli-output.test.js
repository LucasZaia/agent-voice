import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, RECORDER, scriptedPrompter, collector } from './helpers.js';
import { runOutput, addOutput, testOutput, nextFreeName } from '../src/cli/output.js';
import { readStoredConfig, readOutputInstance, writeOutputInstance } from '../src/config.js';
import { TEST_SENTENCE } from '../src/core/phrases.js';

const recorderLine = (sb) => `"${process.execPath}" "${RECORDER}" "${sb.spoken}" {text}`;

test('output add command: asks, saves, enables, then speaks the test sentence', async () => {
  const sb = sandbox();
  const c = collector();
  const io = { env: sb.env, out: c.out, prompt: scriptedPrompter([recorderLine(sb)]) };
  assert.equal(await runOutput(['add', 'command'], io), 0);
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['command']);
  assert.equal(readOutputInstance('command', sb.env).argv[1], RECORDER);
  assert.deepEqual(sb.spokenLines(), [TEST_SENTENCE]);
  assert.match(c.text(), /ok\s+command/);
});

test('a second instance of the same type gets a free name', async () => {
  const sb = sandbox();
  writeOutputInstance('command', { type: 'command', argv: ['x'] }, sb.env);
  assert.equal(nextFreeName('command', sb.env), 'command-2');
});

test('adding over an instance of another type is refused', async () => {
  const sb = sandbox();
  writeOutputInstance('sala', { type: 'alexa', url: 'u', token: 't', entity: 'e' }, sb.env);
  await assert.rejects(addOutput('command', 'sala', { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) }), /already exists with type alexa/);
});

test('unknown type lists the available ones', async () => {
  const sb = sandbox();
  await assert.rejects(runOutput(['add', 'pigeon'], { env: sb.env, out: () => {}, prompt: scriptedPrompter([]) }), /available: alexa, local, command/);
});

test('list marks enabled outputs; disable/enable/remove update config', async () => {
  const sb = sandbox();
  const c = collector();
  const io = { env: sb.env, out: c.out, prompt: scriptedPrompter([recorderLine(sb)]) };
  await runOutput(['add', 'command', 'rec'], io);
  await runOutput(['list'], io);
  assert.match(c.text(), /\* rec\s+command/);
  await runOutput(['disable', 'rec'], io);
  assert.deepEqual(readStoredConfig(sb.env).outputs, []);
  await runOutput(['enable', 'rec'], io);
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['rec']);
  await runOutput(['remove', 'rec'], io);
  assert.equal(readOutputInstance('rec', sb.env), null);
  assert.deepEqual(readStoredConfig(sb.env).outputs, []);
});

test('enable of an unknown output is refused', async () => {
  const sb = sandbox();
  await assert.rejects(runOutput(['enable', 'ghost'], { env: sb.env, out: () => {} }), /no output named "ghost"/);
});

test('list with nothing configured explains how to add one', async () => {
  const sb = sandbox();
  const c = collector();
  await runOutput(['list'], { env: sb.env, out: c.out });
  assert.match(c.text(), /agent-voice output add/);
});

test('test reports failures with the reason and exits 1', async () => {
  const sb = sandbox();
  const c = collector();
  writeOutputInstance('bad', { type: 'command', argv: ['definitely-not-a-command-av'] }, sb.env);
  assert.equal(await testOutput('bad', { env: sb.env, out: c.out }), false);
  assert.match(c.text(), /FAIL\s+bad: command not found/);
});

test('output test with nothing active is an error', async () => {
  const sb = sandbox();
  await assert.rejects(runOutput(['test'], { env: sb.env, out: () => {} }), /no active outputs/);
});
