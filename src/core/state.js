// Per-session state, used by the core only. Keyed by agent and session so that
// concurrent sessions — and concurrent agents — never clobber each other.
// Layout is identical to the bash version, so existing state carries over.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cksum } from './hash.js';

const segment = (raw) => {
  const s = String(raw);
  return `${s.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown'}_${cksum(s)}`;
};

const epochNow = () => Math.floor(Date.now() / 1000);

export function createState(stateDir, now = epochNow) {
  const path = (agent, session) => {
    const dir = join(stateDir, segment(agent));
    mkdirSync(dir, { recursive: true });
    return join(dir, segment(session));
  };
  const read = (file) => {
    try { return readFileSync(file, 'utf8'); } catch { return null; }
  };
  const readEpoch = (file) => {
    const v = read(file)?.trim();
    return v && /^[0-9]+$/.test(v) ? Number(v) : null;
  };

  return {
    path,
    turnStart(agent, session, text) {
      const p = path(agent, session);
      writeFileSync(`${p}.start`, String(now()));
      writeFileSync(`${p}.text`, text ?? '');
    },
    turnElapsed(agent, session) {
      const started = readEpoch(`${path(agent, session)}.start`);
      return started === null ? null : Math.max(0, now() - started);
    },
    turnText(agent, session) {
      return read(`${path(agent, session)}.text`) ?? '';
    },
    turnClear(agent, session) {
      const p = path(agent, session);
      rmSync(`${p}.start`, { force: true });
      rmSync(`${p}.text`, { force: true });
    },
    cooldownStamp(agent, session) {
      writeFileSync(`${path(agent, session)}.cooldown`, String(now()));
    },
    cooldownOk(agent, session, seconds) {
      const last = readEpoch(`${path(agent, session)}.cooldown`);
      return last === null || now() - last >= seconds;
    },
  };
}
