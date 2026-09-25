import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as alexa from '../src/outputs/alexa.js';
import { OUTPUT_TYPES } from '../src/outputs/index.js';
import { scriptedPrompter } from './helpers.js';

// A tiny fake Home Assistant. Records every request it receives.
async function fakeHA({ token = 'good', hang = false } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (hang) return;
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
      if (req.url === '/api/') { res.writeHead(200); res.end('{"message":"API running."}'); return; }
      if (req.url === '/api/states') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          { entity_id: 'light.sala' },
          { entity_id: 'notify.echo_speak' },
          { entity_id: 'notify.echo_announce' },
        ]));
        return;
      }
      if (req.url === '/api/services/notify/send_message') { res.writeHead(200); res.end('[]'); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => { server.closeAllConnections(); server.close(); } };
}

test('speak posts the sentence to notify.send_message with the entity', async () => {
  const ha = await fakeHA();
  try {
    await alexa.speak('olá', { type: 'alexa', url: `${ha.url}/`, token: 'good', entity: 'notify.echo_announce' });
    const last = ha.requests.at(-1);
    assert.equal(last.method, 'POST');
    assert.equal(last.url, '/api/services/notify/send_message');
    assert.deepEqual(JSON.parse(last.body), { entity_id: 'notify.echo_announce', message: 'olá' });
  } finally { ha.close(); }
});

test('a rejected token gives a specific reason', async () => {
  const ha = await fakeHA();
  try {
    await assert.rejects(alexa.speak('x', { type: 'alexa', url: ha.url, token: 'bad', entity: 'notify.e' }), /rejected the token/);
  } finally { ha.close(); }
});

test('an unreachable Home Assistant gives a specific reason', async () => {
  await assert.rejects(
    alexa.speak('x', { type: 'alexa', url: 'http://127.0.0.1:1', token: 't', entity: 'notify.e' }),
    /cannot reach Home Assistant/,
  );
});

test('a hanging Home Assistant times out instead of hanging the hook', async () => {
  const ha = await fakeHA({ hang: true });
  try {
    await assert.rejects(
      alexa.speak('x', { type: 'alexa', url: ha.url, token: 'good', entity: 'notify.e' }, { timeoutMs: 200 }),
      /did not answer/,
    );
  } finally { ha.close(); }
});

test('incomplete config is refused before any request', async () => {
  await assert.rejects(alexa.speak('x', { type: 'alexa', url: 'http://h' }), /missing url, token or entity/);
});

test('questions test the token and offer notify entities, _announce first', async () => {
  const ha = await fakeHA();
  try {
    const prompt = scriptedPrompter([ha.url, 'good', '']);
    const conf = await alexa.questions(prompt, {});
    assert.deepEqual(conf, { type: 'alexa', url: ha.url, token: 'good', entity: 'notify.echo_announce' });
  } finally { ha.close(); }
});

test('questions fail clearly when no notify entity exists', async () => {
  const ha = await fakeHA();
  try {
    const prompt = scriptedPrompter([ha.url, 'good']);
    await assert.rejects(
      alexa.questions(prompt, {}, { fetch: async (u, init) => {
        const res = await fetch(u, init);
        if (u.endsWith('/api/states')) return new Response('[]', { status: 200 });
        return res;
      } }),
      /no notify\.\* entities/,
    );
  } finally { ha.close(); }
});

test('describe never shows the token', () => {
  const d = alexa.describe({ url: 'http://h:8123/', token: 'secret', entity: 'notify.e' });
  assert.equal(d, 'notify.e @ http://h:8123');
  assert.doesNotMatch(d, /secret/);
});

test('alexa is registered', () => assert.equal(OUTPUT_TYPES.alexa, alexa));

test('Home Assistant gets 15s by default, well inside the hook budget', async () => {
  const fetch = async () => { throw Object.assign(new Error('late'), { name: 'TimeoutError' }); };
  await assert.rejects(alexa.speak('x', { type: 'alexa', url: 'http://h', token: 't', entity: 'notify.e' }, { fetch }), /within 15s/);
});
