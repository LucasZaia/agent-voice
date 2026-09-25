// Everything spoken lives here, and it is the only file in Portuguese. Adding a
// language, or changing what the speaker says, touches this file and nothing else.
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

export function phraseTaskDone(agent, place, duration, text) {
  const s = `${agent} terminou ${place}, depois de ${duration}.`;
  return text ? `${s} Você tinha pedido: ${stripTrailingPunct(text)}.` : s;
}

export function phraseBackgroundDone(agent, place, text) {
  const s = `${agent} terminou um trabalho em segundo plano ${place}.`;
  return text ? `${s} Era: ${stripTrailingPunct(text)}.` : s;
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

export function phraseNeedsInput(agent, place, text) {
  const s = `${agent} precisa de você ${place}`;
  return text ? `${s}${translateNotice(stripTrailingPunct(text))}.` : `${s}.`;
}
