// Makes an Echo speak through Home Assistant's notify.send_message service —
// the same call the old falar.sh made, without needing that script.
import { SPEAK_TIMEOUT_MS } from './run.js';

export const type = 'alexa';

const base = (url) => String(url ?? '').replace(/\/+$/, '');

export const describe = (conf) => `${conf.entity} @ ${base(conf.url)}`;

async function call(conf, path, init = {}, deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? SPEAK_TIMEOUT_MS;
  let res;
  try {
    res = await doFetch(`${base(conf.url)}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${conf.token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(`Home Assistant did not answer within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new Error(`cannot reach Home Assistant at ${base(conf.url)} (${e.cause?.code ?? e.message})`);
  }
  if (res.status === 401) throw new Error('Home Assistant rejected the token (HTTP 401)');
  if (!res.ok) throw new Error(`Home Assistant answered HTTP ${res.status}`);
  return res;
}

export async function speak(sentence, conf, deps = {}) {
  if (!conf.url || !conf.token || !conf.entity) throw new Error('alexa output is missing url, token or entity');
  await call(conf, '/api/services/notify/send_message', {
    method: 'POST',
    body: JSON.stringify({ entity_id: conf.entity, message: sentence }),
  }, deps);
}

export async function listNotifyEntities(conf, deps = {}) {
  const res = await call(conf, '/api/states', {}, deps);
  const states = await res.json();
  return (Array.isArray(states) ? states : [])
    .map((s) => s?.entity_id)
    .filter((id) => typeof id === 'string' && id.startsWith('notify.'))
    .sort();
}

export async function questions(prompt, current = {}, deps = {}) {
  const url = base(await prompt.ask('Home Assistant URL', current.url ?? 'http://localhost:8123'));
  // A saved token is never echoed back: Enter keeps it, the hint shows its end.
  const tail = String(current.token ?? '').length >= 16 ? ` …${String(current.token).slice(-4)}` : '';
  const saved = current.token ? ` [saved token${tail}, Enter keeps it]` : '';
  const token = (await prompt.ask(`Long-lived access token (Home Assistant → your profile → Security)${saved}`, '')) || current.token || '';
  const conf = { type, url, token, entity: '' };
  await call(conf, '/api/', {}, deps);
  const entities = await listNotifyEntities(conf, deps);
  if (entities.length === 0) {
    throw new Error('Home Assistant has no notify.* entities — is the Alexa Media Player integration set up?');
  }
  const ordered = [...entities.filter((e) => e.endsWith('_announce')), ...entities.filter((e) => !e.endsWith('_announce'))];
  const def = Math.max(0, ordered.indexOf(current.entity));
  const i = await prompt.choose('Which device should speak? (_announce plays a chime first)', ordered, def);
  conf.entity = ordered[i];
  return conf;
}
