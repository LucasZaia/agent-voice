import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, RECORDER, scriptedPrompter, collector } from './helpers.js';
import { runSetup } from '../src/cli/setup.js';
import { cancelledError } from '../src/cli/prompt.js';
import { readStoredConfig, readOutputInstance } from '../src/config.js';
import { TEST_SENTENCE } from '../src/core/phrases.js';

const COMMAND_INDEX = 2; // choices are listed as alexa, local, command
const recorderLine = (sb) => `"${process.execPath}" "${RECORDER}" "${sb.spoken}" {text}`;

test('fresh machine with Claude Code: connect, add a command output, hear it, done', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  const c = collector();
  const prompt = scriptedPrompter([true, COMMAND_INDEX, recorderLine(sb), true]);
  assert.equal(await runSetup([], { env: sb.env, out: c.out, prompt }), 0);
  const hooks = JSON.parse(readFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')).hooks;
  assert.ok(hooks.Stop);
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['command']);
  assert.deepEqual(sb.spokenLines(), [TEST_SENTENCE]);
  assert.match(c.text(), /agent-voice status/);
});

test('"did not hear it" removes the output and asks again', async () => {
  const sb = sandbox();
  const prompt = scriptedPrompter([COMMAND_INDEX, recorderLine(sb), false, true, COMMAND_INDEX, recorderLine(sb), true]);
  await runSetup([], { env: sb.env, out: () => {}, prompt });
  assert.deepEqual(readStoredConfig(sb.env).outputs, ['command']);
  assert.equal(sb.spokenLines().length, 2);
});

test('a failing output setup can be abandoned without crashing', async () => {
  const sb = sandbox();
  const c = collector();
  const prompt = scriptedPrompter([COMMAND_INDEX, '   ', false]);
  assert.equal(await runSetup([], { env: sb.env, out: c.out, prompt }), 0);
  assert.match(c.text(), /Could not set up command: a command is required/);
});

test('a speaker that fails the test is removed', async () => {
  const sb = sandbox();
  const prompt = scriptedPrompter([COMMAND_INDEX, 'definitely-not-a-command-av {text}', false]);
  await runSetup([], { env: sb.env, out: () => {}, prompt });
  assert.equal(readOutputInstance('command', sb.env), null);
  assert.deepEqual(readStoredConfig(sb.env).outputs, []);
});

test('re-running with everything set up only asks whether to add another output', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  await runSetup([], { env: sb.env, out: () => {}, prompt: scriptedPrompter([true, COMMAND_INDEX, recorderLine(sb), true]) });
  const c = collector();
  const prompt = scriptedPrompter([false]);
  await runSetup([], { env: sb.env, out: c.out, prompt });
  assert.equal(prompt.asked.length, 1);
  assert.match(c.text(), /claude-code: already connected/);
});

test('no agent installed points to wrap', async () => {
  const sb = sandbox();
  const c = collector();
  await runSetup([], { env: sb.env, out: c.out, prompt: scriptedPrompter([COMMAND_INDEX, recorderLine(sb), true]) });
  assert.match(c.text(), /agent-voice wrap --/);
});

test('cancelling inside an output question stops setup instead of offering a retry', async () => {
  const sb = sandbox();
  const c = collector();
  const prompt = scriptedPrompter([COMMAND_INDEX]);
  prompt.ask = async () => { throw cancelledError(); };
  await assert.rejects(runSetup([], { env: sb.env, out: c.out, prompt }), { code: 'CANCELLED' });
  assert.doesNotMatch(c.text(), /Could not set up/);
});

test('one unreadable agent config is reported and the other agents still connect', async () => {
  const sb = sandbox();
  mkdirSync(sb.env.CLAUDE_CONFIG_DIR, { recursive: true });
  mkdirSync(sb.env.CODEX_HOME, { recursive: true });
  writeFileSync(join(sb.env.CLAUDE_CONFIG_DIR, 'settings.json'), '{ broken');
  const c = collector();
  const prompt = scriptedPrompter([true, true, COMMAND_INDEX, recorderLine(sb), true]);
  assert.equal(await runSetup([], { env: sb.env, out: c.out, prompt }), 0);
  assert.match(c.text(), /claude-code: could not connect — .*invalid JSON/);
  assert.ok(JSON.parse(readFileSync(join(sb.env.CODEX_HOME, 'hooks.json'), 'utf8')).hooks.Stop);
  assert.deepEqual(sb.spokenLines(), [TEST_SENTENCE]);
});
