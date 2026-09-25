// One line per firing. Without this, a hook that chose to stay silent and a
// hook that died look identical from the outside.
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const pad2 = (n) => String(n).padStart(2, '0');

export function timestamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatLine(agent, session, message, d = new Date()) {
  return `${timestamp(d)} ${String(agent).padEnd(12)} ${String(session).slice(0, 8).padEnd(10)} ${message}\n`;
}

export function log(stateDir, agent, session, message, d = new Date()) {
  try {
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(join(stateDir, 'events.log'), formatLine(agent, session, message, d));
  } catch {
    // The log is the last resort; there is nothing left to report a failure to.
  }
}
