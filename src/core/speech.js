// Turns written text into something worth hearing. A speaker reading a URL or
// a card id out loud is unbearable, and markdown syntax is noise in speech.
const EMOJI = /[\u{2190}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu;

export function cleanSpeech(input, max) {
  const text = (typeof input === 'string' ? input : '')
    .replace(/\n/g, ' ')
    // Tags from agent-injected markup (<task-id>, <br/>): keep the text, drop the tag.
    .replace(/<\/?[A-Za-z][\w-]*(\s[^<>]*)?\/?>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^ ]*/g, '')
    // File paths. Must run after the URL rule: by now every URL is gone, so this
    // cannot eat half of one. Needs two slashes; a lone "/etc" is left alone.
    .replace(/\/[^ ]*\/[^ ]*/g, '')
    .replace(/\[#?[0-9]+\]\s*/g, '')
    .replace(/[[\]]/g, '')
    .replace(/[`*#>]/g, '')
    .replace(/_/g, ' ')
    .replace(EMOJI, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^ /, '')
    .replace(/ $/, '');
  return Array.from(text).slice(0, max).join('');
}

// Used before joining two fragments, so "travados." + "." does not become "travados..".
export function stripTrailingPunct(text) {
  return String(text).replace(/[\s.!:;,-]+$/u, '');
}
