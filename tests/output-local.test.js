import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as local from '../src/outputs/local.js';
import { OUTPUT_TYPES } from '../src/outputs/index.js';
import { scriptedPrompter } from './helpers.js';

const finder = (present) => (cmd) => (present.includes(cmd) ? `/usr/bin/${cmd}` : null);

test('backend per OS', () => {
  assert.equal(local.detectBackend('darwin', {}, finder([])), 'say');
  assert.equal(local.detectBackend('win32', {}, finder([])), 'sapi');
  assert.equal(local.detectBackend('linux', {}, finder(['espeak', 'spd-say'])), 'spd-say');
  assert.equal(local.detectBackend('linux', {}, finder(['espeak', 'espeak-ng'])), 'espeak-ng');
  assert.equal(local.detectBackend('linux', {}, finder(['espeak'])), 'espeak');
  assert.equal(local.detectBackend('linux', {}, finder([])), null);
});

test('say passes the voice and the sentence as arguments', () => {
  assert.deepEqual(local.commandFor('say', 'olá', 'Luciana'), { cmd: 'say', args: ['-v', 'Luciana', 'olá'], input: '' });
  assert.deepEqual(local.commandFor('say', 'olá', ''), { cmd: 'say', args: ['olá'], input: '' });
});

test('sapi sends the sentence on stdin, never inside the script', () => {
  const c = local.commandFor('sapi', 'frase "com" aspas', 'Microsoft Maria');
  assert.equal(c.cmd, 'powershell.exe');
  assert.equal(c.input, 'frase "com" aspas');
  assert.ok(!c.args.join(' ').includes('aspas'));
  assert.equal(c.env.AV_VOICE, 'Microsoft Maria');
});

test('linux backends default to Portuguese', () => {
  assert.deepEqual(local.commandFor('spd-say', 'oi', ''), { cmd: 'spd-say', args: ['-w', '-l', 'pt', 'oi'], input: '' });
  assert.deepEqual(local.commandFor('espeak-ng', 'oi', ''), { cmd: 'espeak-ng', args: ['-v', 'pt-br', 'oi'], input: '' });
});

test('unknown backend is refused', () => {
  assert.throws(() => local.commandFor('beep', 'x'), /unknown local voice backend/);
});

test('defaultVoice picks the first pt_BR voice from `say -v ?`', async () => {
  const fakeSpawnOutput = 'Alex                en_US    # Hello\nLuciana             pt_BR    # Olá\n';
  const voice = await local.defaultVoice('say', { run: async () => fakeSpawnOutput });
  assert.equal(voice, 'Luciana');
});

test('defaultVoice picks the pt-BR SAPI voice', async () => {
  const voice = await local.defaultVoice('sapi', { run: async () => 'en-US|Microsoft Zira\r\npt-BR|Microsoft Maria\r\n' });
  assert.equal(voice, 'Microsoft Maria');
});

test('questions explain how to get a voice when none exists', async () => {
  await assert.rejects(
    local.questions(scriptedPrompter([]), {}, { platform: 'linux', env: {}, find: finder([]) }),
    /install espeak-ng/,
  );
});

test('questions keep the suggested voice on Enter', async () => {
  const conf = await local.questions(scriptedPrompter(['']), {}, { platform: 'linux', env: {}, find: finder(['espeak-ng']) });
  assert.deepEqual(conf, { type: 'local', backend: 'espeak-ng', voice: 'pt-br' });
});

test('local is registered', () => assert.equal(OUTPUT_TYPES.local, local));
