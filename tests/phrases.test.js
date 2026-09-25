import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/core/phrases.js';

test('known agents get a display name', () => {
  assert.equal(p.agentName('claude-code'), 'Claude Code');
  assert.equal(p.agentName('codex'), 'Codex');
  assert.equal(p.agentName('wrap'), 'O comando');
});
test('unknown agent falls back to its id', () => assert.equal(p.agentName('aider'), 'aider'));

test('session labels are pinned to the bash values', () => {
  assert.equal(p.sessionLabel('abc123'), 'roxa');
  assert.equal(p.sessionLabel('sid1'), 'verde');
  assert.equal(p.sessionLabel('c4'), 'vermelha');
});

test('where prefers the session name', () =>
  assert.equal(p.where('sid1', 'Home assistant repo', 'home-assistant'), 'na sessão Home assistant repo'));
test('where falls back to label plus project', () =>
  assert.equal(p.where('sid1', '', 'home-assistant'), 'na sessão verde, do projeto home-assistant'));
test('where with neither name nor project', () => assert.equal(p.where('sid1', '', ''), 'na sessão verde'));

test('durations', () => {
  assert.equal(p.durationPhrase(61), 'cerca de um minuto');
  assert.equal(p.durationPhrase(240), 'cerca de 4 minutos');
  assert.equal(p.durationPhrase(600), 'cerca de 10 minutos');
});

test('task done with and without request', () => {
  assert.equal(p.phraseTaskDone('Claude Code', 'na sessão X', 'cerca de 4 minutos', 'criar o compose.'),
    'Claude Code terminou na sessão X, depois de cerca de 4 minutos. Você tinha pedido: criar o compose.');
  assert.equal(p.phraseTaskDone('Claude Code', 'na sessão X', 'cerca de 4 minutos', ''),
    'Claude Code terminou na sessão X, depois de cerca de 4 minutos.');
});

test('background done', () => assert.equal(
  p.phraseBackgroundDone('Claude Code', 'na sessão X', 'revisor'),
  'Claude Code terminou um trabalho em segundo plano na sessão X. Era: revisor.'));

test('needs input: notices are translated or dropped', () => {
  const s = (t) => p.phraseNeedsInput('Claude Code', 'na sessão X', t);
  assert.equal(s('Claude needs your permission'), 'Claude Code precisa de você na sessão X.');
  assert.equal(s('Claude needs your permission to use Bash'), 'Claude Code precisa de você na sessão X, para usar o Bash.');
  assert.equal(s('Claude is waiting for your input'), 'Claude Code precisa de você na sessão X, e está esperando sua resposta.');
  assert.equal(s('algo inesperado'), 'Claude Code precisa de você na sessão X. algo inesperado.');
  assert.equal(s(''), 'Claude Code precisa de você na sessão X.');
});

test('the test sentence is Portuguese', () => assert.match(p.TEST_SENTENCE, /agent voice/));
