// Everything spoken lives here, and it is the only file in Portuguese. Adding a
// language touches this file and nothing else; users reword the sentences
// through config.json "phrases" (see DEFAULT_PHRASES).
import { cksum } from './hash.js';
import { stripTrailingPunct } from './speech.js';

const AGENT_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', wrap: 'O comando' };

// Spoken fallback identity when an agent cannot supply a session name.
// "sessão zero quatro cê zero" is useless to hear; a colour is not.
export const LABELS = ['azul', 'verde', 'vermelha', 'amarela', 'roxa', 'laranja', 'dourada', 'prateada', 'turquesa', 'violeta'];

export const TEST_SENTENCE = 'Teste do agent voice. Se você está ouvindo, está funcionando.';

export const agentName = (agent) => (Object.hasOwn(AGENT_NAMES, agent) ? AGENT_NAMES[agent] : agent);

export const sessionLabel = (sessionId) => LABELS[cksum(sessionId) % LABELS.length];

export function where(sessionId, name, project) {
  if (name) return `na sessão ${name}`;
  if (project) return `na sessão ${sessionLabel(sessionId)}, do projeto ${project}`;
  return `na sessão ${sessionLabel(sessionId)}`;
}

export function durationPhrase(seconds) {
  const minutes = Math.floor((seconds + 30) / 60);
  return minutes <= 1 ? 'cerca de um minuto' : `cerca de ${minutes} minutos`;
}

// The spoken sentences, as templates the user can override (config.json
// "phrases"). {name} is a variable; a [section] is spoken only when every
// variable inside it has a value, so "[ Era: {text}.]" vanishes with no text.
export const DEFAULT_PHRASES = Object.freeze({
  taskDone: '{agent} terminou {where}, depois de {duration}.[ Você tinha pedido: {request}.]',
  backgroundDone: '{agent} terminou um trabalho em segundo plano {where}.[ Era: {text}.]',
  needsInput: '{agent} precisa de você {where}{notice}.',
});

export const PHRASE_VARS = Object.freeze({
  taskDone: ['agent', 'where', 'duration', 'request'],
  backgroundDone: ['agent', 'where', 'text'],
  needsInput: ['agent', 'where', 'notice'],
});

const MAX_TEMPLATE_CHARS = 300;
const VAR_RE = /\{([^{}]*)\}/g;

// null when the template is usable, otherwise the reason it is not.
export function validateTemplate(name, template) {
  if (!Object.hasOwn(PHRASE_VARS, name)) return `unknown phrase "${name}" (phrases: ${Object.keys(PHRASE_VARS).join(', ')})`;
  if (typeof template !== 'string' || !template.trim()) return `phrases.${name} is empty`;
  if (template.length > MAX_TEMPLATE_CHARS) return `phrases.${name} is too long (max ${MAX_TEMPLATE_CHARS} characters)`;
  let depth = 0;
  for (const ch of template) {
    if (ch === '[') depth += 1;
    if (ch === ']') depth -= 1;
    if (depth < 0 || depth > 1) return `phrases.${name}: brackets must be balanced and not nested`;
  }
  if (depth !== 0) return `phrases.${name}: brackets must be balanced and not nested`;
  for (const [, v] of template.matchAll(VAR_RE)) {
    if (!PHRASE_VARS[name].includes(v)) return `phrases.${name}: unknown variable {${v}} (use: ${PHRASE_VARS[name].join(', ')})`;
  }
  return null;
}

function render(name, templates, vars) {
  const custom = templates?.[name];
  const template = custom !== undefined && validateTemplate(name, custom) === null ? custom : DEFAULT_PHRASES[name];
  const fill = (part) => part.replace(VAR_RE, (_, v) => vars[v] ?? '');
  return template
    .replace(/\[([^\]]*)\]/g, (_, inner) => ([...inner.matchAll(VAR_RE)].every(([, v]) => vars[v]) ? fill(inner) : ''))
    .replace(VAR_RE, (_, v) => vars[v] ?? '');
}

export function phraseTaskDone(agent, place, duration, text, templates) {
  return render('taskDone', templates, { agent, where: place, duration, request: text ? stripTrailingPunct(text) : '' });
}

export function phraseBackgroundDone(agent, place, text, templates) {
  return render('backgroundDone', templates, { agent, where: place, text: text ? stripTrailingPunct(text) : '' });
}

// Agent notices arrive in English. Speaking one verbatim after a Portuguese
// sentence says the same thing twice, so known notices are translated — and the
// one that merely restates the sentence is dropped. Unknown ones are kept.
export function translateNotice(text) {
  const marker = 'needs your permission to use ';
  const at = text.lastIndexOf(marker);
  if (at !== -1) return `, para usar o ${text.slice(at + marker.length)}`;
  if (text.includes('needs your permission')) return '';
  if (text.includes('waiting for your input')) return ', e está esperando sua resposta';
  return `. ${text}`;
}

export function phraseNeedsInput(agent, place, text, templates) {
  return render('needsInput', templates, { agent, where: place, notice: text ? translateNotice(stripTrailingPunct(text)) : '' });
}
