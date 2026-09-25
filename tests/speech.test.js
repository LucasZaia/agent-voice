import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeech, stripTrailingPunct } from '../src/core/speech.js';

const cases = [
  ['strips markdown link, keeps label', 'olha [essa card](https://app.clickup.com/t/86a) e arruma', 'olha essa card e arruma'],
  ['strips bare URL', 'veja https://exemplo.com/x isto', 'veja isto'],
  ['underscore becomes a space', 'handler de list_pickup', 'handler de list pickup'],
  ['drops bracketed card id', '[#196829] Selly PRO Davi Parra', 'Selly PRO Davi Parra'],
  ['collapses doubled periods', 'pronto.. Foco: x', 'pronto. Foco: x'],
  ['newlines become spaces', 'uma linha\noutra linha', 'uma linha outra linha'],
  ['removes stray brackets', 'text [ with bracket', 'text with bracket'],
  ['strips a file path', 'arruma o /srv/projeto/lib/core.sh agora', 'arruma o agora'],
  ['strips two file paths', 'compara /home/a/b.txt e /home/c/d.txt', 'compara e'],
  ['path rule does not eat a URL', 'veja https://exemplo.com/a/b isto e arruma /home/x/y', 'veja isto e arruma'],
  ['strips emoji and markdown symbols', '✅ **pronto** `ok` # > feito 🚀', 'pronto ok feito'],
];
for (const [name, input, expected] of cases) {
  test(`speech: ${name}`, () => assert.equal(cleanSpeech(input, 90), expected));
}

test('speech: truncates to the limit', () => {
  assert.equal(cleanSpeech('a'.repeat(30), 20), 'a'.repeat(20));
});

test('speech: truncation is safe at a character boundary', () => {
  assert.equal(cleanSpeech('ação extra stuff', 4), 'ação');
});

test('speech: non-string input becomes empty', () => {
  assert.equal(cleanSpeech(undefined, 90), '');
});

test('speech: strips trailing punctuation', () => {
  assert.equal(stripTrailingPunct('travados.'), 'travados');
  assert.equal(stripTrailingPunct('ok !:; - '), 'ok');
});
