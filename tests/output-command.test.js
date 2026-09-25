import { test } from 'node:test';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { sandbox, RECORDER, scriptedPrompter } from './helpers.js';
import * as command from '../src/outputs/command.js';
import { run, SPEAK_TIMEOUT_MS } from '../src/outputs/run.js';
import { OUTPUT_TYPES, resolveOutputs } from '../src/outputs/index.js';
import { writeOutputInstance } from '../src/config.js';

test('parseCommandLine splits on spaces and honours quotes', () => {
  assert.deepEqual(command.parseCommandLine('falar.sh -a {text}'), ['falar.sh', '-a', '{text}']);
  assert.deepEqual(command.parseCommandLine(`"C:\\Program Files\\x.exe" 'a b' ""`), ['C:\\Program Files\\x.exe', 'a b', '']);
  assert.throws(() => command.parseCommandLine('"open'), /unclosed quote/);
});

test('{text} is replaced in the arguments', async () => {
  const sb = sandbox();
  await command.speak('olá mundo', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken, '{text}'] });
  assert.deepEqual(sb.spokenLines(), ['olá mundo']);
});

test('without {text} the sentence goes on stdin', async () => {
  const sb = sandbox();
  await command.speak('pelo stdin', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken] });
  assert.deepEqual(sb.spokenLines(), ['pelo stdin']);
});

test('a failing command rejects with its first stderr line', async () => {
  const sb = sandbox();
  await assert.rejects(
    run(process.execPath, [RECORDER, sb.spoken, 'x'], { env: { ...process.env, STUB_FAIL: 'token missing' } }),
    { message: 'token missing' },
  );
});

test('a missing command rejects with a readable reason', async () => {
  await assert.rejects(command.speak('x', { type: 'command', argv: ['definitely-not-a-command-av'] }), /command not found/);
});

test('a hanging command is killed after the timeout', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }), /timed out/);
});

test('questions parse the command line and reject an empty one', async () => {
  const conf = await command.questions(scriptedPrompter(['say {text}']));
  assert.deepEqual(conf, { type: 'command', argv: ['say', '{text}'] });
  await assert.rejects(command.questions(scriptedPrompter(['   '])), /a command is required/);
});

test('describe shows the command line', () => {
  assert.equal(command.describe({ argv: ['falar.sh', '-a', '{text}'] }), 'falar.sh -a {text}');
});

test('resolveOutputs: known instance speaks, missing one has no speak()', async () => {
  const sb = sandbox();
  writeOutputInstance('rec', { type: 'command', argv: [process.execPath, RECORDER, sb.spoken, '{text}'] }, sb.env);
  writeOutputInstance('weird', { type: 'nope' }, sb.env);
  const [rec, missing, weird] = resolveOutputs(['rec', 'ghost', 'weird'], sb.env);
  await rec.speak('frase');
  assert.deepEqual(sb.spokenLines(), ['frase']);
  assert.equal(missing.speak, null);
  assert.equal(weird.speak, null);
  assert.match(weird.reason, /unknown output type nope/);
  assert.ok(OUTPUT_TYPES.command);
});

test('something that exists but cannot be executed says so', async () => {
  const sb = sandbox();
  await assert.rejects(run(sb.dir, []), { message: `not found or not executable: ${sb.dir}` });
});

test('a speaker that leaves audio playing in the background is done when it exits', async () => {
  // The grandchild inherits our pipes and outlives its parent, like `sh -c "play x &"`.
  const bg = "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'inherit' }).unref()";
  const started = Date.now();
  await run(process.execPath, ['-e', bg], { timeoutMs: 2000 });
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started}ms`);
});

test('a failing speaker still reports its stderr when it exits', async () => {
  await assert.rejects(run(process.execPath, ['-e', "process.stderr.write('no voice\\n'); process.exit(2)"]), { message: 'no voice' });
});

test('a speaker gets 15s by default, well inside the hook budget', async () => {
  assert.equal(SPEAK_TIMEOUT_MS, 15000);
  const calls = [];
  await command.speak('x', { type: 'command', argv: ['speaker'] }, { run: async (...a) => { calls.push(a); } });
  assert.equal(calls[0][2].timeoutMs, SPEAK_TIMEOUT_MS);
});

test('~, $HOME and %USERPROFILE% at the start of the command or an argument mean the home dir', () => {
  const home = join('/', 'h', 'u');
  const x = (a) => command.expandHome(a, home);
  assert.equal(x('~'), home);
  assert.equal(x('~/softwares/falar.sh'), join(home, 'softwares/falar.sh'));
  assert.equal(x('$HOME/falar.sh'), join(home, 'falar.sh'));
  assert.equal(x('${HOME}/falar.sh'), join(home, 'falar.sh'));
  assert.equal(x('%USERPROFILE%\\falar.cmd'), join(home, 'falar.cmd'));
  assert.equal(x('%userprofile%\\falar.cmd'), join(home, 'falar.cmd'));
  assert.equal(x('~other/x'), '~other/x');
  assert.equal(x('a~/x'), 'a~/x');
  assert.equal(x('-a'), '-a');
});

test('the README upgrade line works: a ~ path speaks, and the sentence itself is never expanded', async () => {
  const sb = sandbox();
  const home = join(sb.dir, 'home');
  mkdirSync(home, { recursive: true });
  copyFileSync(RECORDER, join(home, 'rec.mjs'));
  const argv = command.parseCommandLine(`"${process.execPath}" ~/rec.mjs "${sb.spoken}" {text}`);
  await command.speak('~/nada $HOME', { type: 'command', argv }, { home });
  assert.deepEqual(sb.spokenLines(), ['~/nada $HOME']);
});
