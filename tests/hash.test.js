import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cksum } from '../src/core/hash.js';

test('cksum matches POSIX cksum byte for byte', () => {
  const known = {
    abc123: 719354, sid1: 123442821, c4: 3439070372, 'claude-code': 3860518746,
    'a/b': 3840401949, ab: 2072780115, '': 4294967295, 'ação': 1164746233,
  };
  for (const [input, expected] of Object.entries(known)) assert.equal(cksum(input), expected, input);
});

test('cksum is order-sensitive: a/b and ab differ', () => {
  assert.notEqual(cksum('a/b'), cksum('ab'));
});
