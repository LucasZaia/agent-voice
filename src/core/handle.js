// The only component that remembers or decides anything. Adapters hand it a
// canonical event; it completes that event from state, applies the rules,
// builds the sentence and dispatches to every active output.
import { cleanSpeech } from './speech.js';
import {
  agentName, where as whereOf, durationPhrase, phraseTaskDone, phraseBackgroundDone, phraseNeedsInput,
} from './phrases.js';

const str = (v) => (typeof v === 'string' ? v : '');

export async function speakAll(agent, session, sentence, ctx) {
  ctx.state.cooldownStamp(agent, session);
  for (const out of ctx.outputs) {
    if (!out.speak) {
      ctx.log(agent, session, `no such output: ${out.name}${out.reason ? ` (${out.reason})` : ''}`);
      continue;
    }
    try {
      await out.speak(sentence);
      ctx.log(agent, session, `spoke via ${out.name}: ${sentence}`);
    } catch (e) {
      // "container down", "token missing" and "HTTP 401" must stay distinguishable
      // from each other, and from a hook that simply chose to stay quiet.
      const reason = String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 120) || 'failed with no reason';
      ctx.log(agent, session, `FAILED via ${out.name} (${reason}): ${sentence}`);
    }
  }
}

export async function handle(event, ctx) {
  const e = event && typeof event === 'object' ? event : {};
  const type = str(e.type);
  const agent = str(e.agent);
  const session = str(e.session_id);
  if (!type || !agent || !session) {
    ctx.log(agent || '?', session || '?', 'ignored: incomplete event');
    return;
  }

  // session_name and project come straight from the agent (an AI-written title,
  // a directory name) — never speech-safe by construction, so cleaned here once.
  const clean = (t) => cleanSpeech(t, ctx.config.maxSpeechChars);
  const who = agentName(agent);
  const place = whereOf(session, clean(str(e.session_name)), clean(str(e.project)));
  const text = str(e.text);
  let sentence;

  switch (type) {
    case 'turn_start':
      ctx.state.turnStart(agent, session, text);
      ctx.log(agent, session, 'turn started');
      return;

    case 'task_done': {
      const elapsed = ctx.state.turnElapsed(agent, session);
      if (elapsed === null) {
        ctx.log(agent, session, 'ignored: task_done with no turn marker');
        return;
      }
      // The request came from turn_start; the stop hook never carries it.
      const asked = ctx.state.turnText(agent, session);
      ctx.state.turnClear(agent, session);
      if (elapsed < ctx.config.minSeconds) {
        ctx.log(agent, session, `silent (turn ${elapsed}s < ${ctx.config.minSeconds}s)`);
        return;
      }
      sentence = phraseTaskDone(who, place, durationPhrase(elapsed), clean(asked));
      break;
    }

    case 'background_done':
      if (!ctx.state.cooldownOk(agent, session, ctx.config.cooldownSeconds)) {
        ctx.log(agent, session, `silent (cooldown ${ctx.config.cooldownSeconds}s)`);
        return;
      }
      // Background events fire often; a sentence with no content is noise.
      if (!text) {
        ctx.log(agent, session, 'silent (background_done with no content)');
        return;
      }
      sentence = phraseBackgroundDone(who, place, clean(text));
      break;

    case 'needs_input':
      sentence = phraseNeedsInput(who, place, clean(text));
      break;

    default:
      ctx.log(agent, session, `ignored: unknown type ${type}`);
      return;
  }

  await speakAll(agent, session, sentence, ctx);
}
