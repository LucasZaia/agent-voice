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

test('templates: defaults reproduce the built-in sentences exactly', () => {
  for (const [name, tpl] of Object.entries(p.DEFAULT_PHRASES)) assert.equal(p.validateTemplate(name, tpl), null, name);
  assert.equal(p.phraseTaskDone('Claude Code', 'na sessão X', 'cerca de 4 minutos', 'criar o compose.', p.DEFAULT_PHRASES),
    'Claude Code terminou na sessão X, depois de cerca de 4 minutos. Você tinha pedido: criar o compose.');
});

test('templates: a custom sentence uses the variables', () => {
  const t = { taskDone: '{agent} acabou {where}, levou {duration}.[ Pedido: {request}.]' };
  assert.equal(p.phraseTaskDone('Codex', 'na sessão azul', 'cerca de 2 minutos', 'rodar os testes', t),
    'Codex acabou na sessão azul, levou cerca de 2 minutos. Pedido: rodar os testes.');
});

test('templates: an optional [section] disappears when its variable is empty', () => {
  const t = { taskDone: '{agent} acabou.[ Pedido: {request}.]' };
  assert.equal(p.phraseTaskDone('Codex', 'x', 'y', '', t), 'Codex acabou.');
  const b = { backgroundDone: '[{text} pronto ]{where}.' };
  assert.equal(p.phraseBackgroundDone('Codex', 'na sessão X', 'revisor', b), 'revisor pronto na sessão X.');
});

test('templates: needsInput keeps the translated notice', () => {
  const t = { needsInput: 'Ei, {agent} precisa de você {where}{notice}!' };
  assert.equal(p.phraseNeedsInput('Claude Code', 'na sessão X', 'Claude needs your permission to use Bash', t),
    'Ei, Claude Code precisa de você na sessão X, para usar o Bash!');
});

test('templates: a missing entry falls back to the default', () => {
  assert.equal(p.phraseBackgroundDone('Claude Code', 'na sessão X', 'revisor', { taskDone: '{agent}' }),
    'Claude Code terminou um trabalho em segundo plano na sessão X. Era: revisor.');
});

test('templates: validation rejects what would speak broken text', () => {
  assert.match(p.validateTemplate('taskDone', '{agent} {texto}'), /unknown variable \{texto\}.*agent, where, duration, request/);
  assert.match(p.validateTemplate('needsInput', '{agent} {request}'), /unknown variable \{request\}/);
  assert.match(p.validateTemplate('taskDone', '{agent} [a [b]]'), /brackets/);
  assert.match(p.validateTemplate('taskDone', '{agent} ]'), /brackets/);
  assert.match(p.validateTemplate('taskDone', '   '), /empty/);
  assert.match(p.validateTemplate('taskDone', 42), /empty/);
  assert.match(p.validateTemplate('nope', '{agent}'), /unknown phrase "nope"/);
  assert.match(p.validateTemplate('taskDone', `{agent}${'x'.repeat(300)}`), /too long/);
});
