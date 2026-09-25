// Merges agent-voice's hooks into an agent's JSON config (Claude Code's
// settings.json, Codex's hooks.json — same shape). Rules: never touch foreign
// hooks, never duplicate ours, back up before writing, and on anything
// unexpected abort without writing a byte.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const hookCommand = (env = process.env) => env.AV_HOOK_COMMAND || 'agent-voice';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isLegacy = (command) => typeof command === 'string' && /bin[\\/]notify"?\s/.test(command);

export function isOurs(command, agent) {
  if (typeof command !== 'string') return false;
  if (!new RegExp(`\\bnotify"?\\s+${escapeRe(agent)}(\\s|$)`).test(command)) return false;
  return /agent-voice/.test(command) || isLegacy(command);
}

function eventsOf(settings, file = 'settings') {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${file}: expected a JSON object — nothing was written`);
  }
  if (settings.hooks === undefined) return {};
  const { hooks } = settings;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error(`${file}: "hooks" is not an object — nothing was written`);
  }
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`${file}: hooks.${event} is not a list — nothing was written`);
  }
  return hooks;
}

export function removeHooks(settings, agent, file) {
  const hooks = eventsOf(settings, file);
  const next = {};
  let removed = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const ours = group.hooks.filter((x) => isOurs(x?.command, agent));
      if (ours.length === 0) { kept.push(group); continue; }
      removed += ours.length;
      const rest = group.hooks.filter((x) => !isOurs(x?.command, agent));
      if (rest.length) kept.push({ ...group, hooks: rest });
    }
    if (kept.length || groups.length === 0) next[event] = kept;
  }
  if (removed === 0) return { settings, removed };
  const out = { ...settings };
  if (Object.keys(next).length) out.hooks = next;
  else delete out.hooks;
  return { settings: out, removed };
}

export function mergeHooks(settings, agent, defs, command, file) {
  const { settings: base } = removeHooks(settings, agent, file);
  const hooks = { ...(base.hooks ?? {}) };
  for (const d of defs) {
    const entry = { type: 'command', command: `${command} notify ${agent} ${d.sub}`, ...(d.async ? { async: true } : {}), timeout: d.timeout };
    hooks[d.event] = [...(hooks[d.event] ?? []), { hooks: [entry] }];
  }
  return { ...base, hooks };
}

export function hookStatus(settings, agent, defs, file) {
  const hooks = eventsOf(settings, file);
  const ours = Object.values(hooks).flat()
    .flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : []))
    .filter((x) => isOurs(x?.command, agent));
  if (ours.some((x) => isLegacy(x.command))) return 'legacy';
  const has = (d) => ((hooks[d.event] ?? [])
    .some((g) => g && Array.isArray(g.hooks) && g.hooks.some((x) => isOurs(x?.command, agent) && x.command.trimEnd().endsWith(` ${agent} ${d.sub}`))));
  const n = defs.filter(has).length;
  if (n === defs.length) return 'connected';
  return n === 0 ? 'not connected' : 'partially connected';
}

function readSettings(file) {
  if (!existsSync(file)) return { settings: {}, existed: false };
  const raw = readFileSync(file, 'utf8');
  if (raw.trim() === '') return { settings: {}, existed: true };
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file}: invalid JSON (${e.message}) — nothing was written`);
  }
  eventsOf(settings, file);
  return { settings, existed: true };
}

const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

function writeSettings(file, existed, before, next, now) {
  if (JSON.stringify(before) === JSON.stringify(next)) return { changed: false, backup: null };
  mkdirSync(dirname(file), { recursive: true });
  let backup = null;
  if (existed) {
    backup = `${file}.bak-${stamp(now)}`;
    copyFileSync(file, backup);
  }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, backup };
}

export function connectFile(file, agent, defs, { command, now = new Date() } = {}) {
  const { settings, existed } = readSettings(file);
  return writeSettings(file, existed, settings, mergeHooks(settings, agent, defs, command, file), now);
}

export function disconnectFile(file, agent, { now = new Date() } = {}) {
  if (!existsSync(file)) return { changed: false, backup: null };
  const { settings, existed } = readSettings(file);
  return writeSettings(file, existed, settings, removeHooks(settings, agent, file).settings, now);
}

export function fileStatus(file, agent, defs) {
  try {
    return hookStatus(readSettings(file).settings, agent, defs, file);
  } catch (e) {
    return `unreadable (${e.message})`;
  }
}
