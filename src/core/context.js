import { loadConfig } from '../config.js';
import { createState } from './state.js';
import { log } from './log.js';
import { resolveOutputs } from '../outputs/index.js';

export function createContext(env = process.env) {
  const config = loadConfig(env);
  return {
    config,
    state: createState(config.stateDir),
    log: (agent, session, message) => log(config.stateDir, agent, session, message),
    outputs: resolveOutputs(config.outputs, env),
  };
}
