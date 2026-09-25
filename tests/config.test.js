import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import * as c from '../src/config.js';

test('defaults when nothing is stored', () => {
  const { env } = sandbox();
  const cfg = c.loadConfig(env);
  assert.equal(cfg.minSeconds, 30);
  assert.equal(cfg.cooldownSeconds, 120);
  assert.equal(cfg.maxSpeechChars, 90);
  assert.deepEqual(cfg.outputs, []);
  assert.equal(cfg.stateDir, env.AV_STATE_DIR);
});

test('config.json overrides defaults, environment overrides config.json', () => {
  const { env } = sandbox();
  c.saveConfig({ minSeconds: 45, outputs: ['alexa'] }, env);
  assert.equal(c.loadConfig(env).minSeconds, 45);
  assert.equal(c.loadConfig({ ...env, AV_MIN_SECONDS: '10', AV_OUTPUTS: 'a b' }).minSeconds, 10);
  assert.deepEqual(c.loadConfig({ ...env, AV_OUTPUTS: ' a  b ' }).outputs, ['a', 'b']);
});

test('a non-numeric env override is ignored', () => {
  const { env } = sandbox();
  assert.equal(c.loadConfig({ ...env, AV_MIN_SECONDS: 'soon' }).minSeconds, 30);
});

test('saveConfig merges instead of replacing', () => {
  const { env } = sandbox();
  c.saveConfig({ minSeconds: 45 }, env);
  c.saveConfig({ outputs: ['x'] }, env);
  assert.deepEqual(c.readStoredConfig(env), { minSeconds: 45, outputs: ['x'] });
});

test('corrupt config.json throws naming the file', () => {
  const { env } = sandbox();
  mkdirSync(env.AV_CONFIG_DIR, { recursive: true });
  writeFileSync(join(env.AV_CONFIG_DIR, 'config.json'), '{ nope');
  assert.throws(() => c.loadConfig(env), /config\.json: invalid JSON/);
});

test('output instances round-trip, list sorted, and are removable', () => {
  const { env } = sandbox();
  c.writeOutputInstance('sala', { type: 'alexa', url: 'u', token: 't', entity: 'e' }, env);
  c.writeOutputInstance('local', { type: 'local', backend: 'say', voice: '' }, env);
  assert.equal(c.readOutputInstance('sala', env).token, 't');
  assert.deepEqual(c.listOutputInstances(env).map((o) => o.name), ['local', 'sala']);
  c.removeOutputInstance('sala', env);
  assert.equal(c.readOutputInstance('sala', env), null);
});

test('instance files are private (0600) where the OS supports it', { skip: process.platform === 'win32' }, () => {
  const { env } = sandbox();
  c.writeOutputInstance('sala', { type: 'alexa', token: 'secret' }, env);
  assert.equal(statSync(join(env.AV_CONFIG_DIR, 'outputs', 'sala.json')).mode & 0o777, 0o600);
});

test('output names are validated, so AV_OUTPUTS cannot escape the config dir', () => {
  const { env } = sandbox();
  assert.equal(c.isValidOutputName('alexa-sala'), true);
  assert.equal(c.isValidOutputName('../x'), false);
  assert.equal(c.isValidOutputName('Alexa'), false);
  assert.equal(c.readOutputInstance('../../etc/passwd', env), null);
  assert.throws(() => c.writeOutputInstance('../x', {}, env), /invalid output name/);
});

test('a corrupt instance is listed with its error instead of breaking the list', () => {
  const { env } = sandbox();
  mkdirSync(join(env.AV_CONFIG_DIR, 'outputs'), { recursive: true });
  writeFileSync(join(env.AV_CONFIG_DIR, 'outputs', 'bad.json'), 'nope');
  const [bad] = c.listOutputInstances(env);
  assert.equal(bad.name, 'bad');
  assert.equal(bad.conf, null);
  assert.match(bad.error, /invalid JSON/);
});

test('written JSON is pretty-printed with a trailing newline', () => {
  const { env } = sandbox();
  c.saveConfig({ minSeconds: 45 }, env);
  assert.equal(readFileSync(join(env.AV_CONFIG_DIR, 'config.json'), 'utf8'), '{\n  "minSeconds": 45\n}\n');
});

test('a UTF-8 BOM in config.json or an instance file is accepted', () => {
  const { env } = sandbox();
  mkdirSync(join(env.AV_CONFIG_DIR, 'outputs'), { recursive: true });
  writeFileSync(join(env.AV_CONFIG_DIR, 'config.json'), '﻿{"minSeconds": 45}');
  writeFileSync(join(env.AV_CONFIG_DIR, 'outputs', 'x.json'), '﻿{"type": "command", "argv": ["say"]}');
  assert.equal(c.loadConfig(env).minSeconds, 45);
  assert.equal(c.readOutputInstance('x', env).type, 'command');
});
