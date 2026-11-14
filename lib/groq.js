// Groq: Whisper for speech-to-text, an LLM for turning speech into screenplay edits.
import { SYSTEM_PROMPT } from './prompt.js';
import { lang } from '../public/languages.js';
import { devanagariToRoman, hasNonLatin } from './translit.js';

const BASE = 'https://api.groq.com/openai/v1';
// The key comes from the user's Settings (set by main.js, decrypted with safeStorage)
// or, for development, from GROQ_API_KEY in .env.
let userKey = null;
export const setApiKey = (k) => { userKey = k || null; };
const key = () => userKey || process.env.GROQ_API_KEY;

export const hasKey = () => Boolean(key());
export const keySource = () => (userKey ? 'saved' : process.env.GROQ_API_KEY ? 'env' : null);

// Checks a key against Groq without spending tokens. ok:true, or ok:false with a reason.
export async function checkKey(k) {
  try {
    const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: `groq-${res.status}` };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

// Whisper loves to "hear" these in silence. Drop them.
const HALLUCINATIONS = [
  /thank(s| you) for watching/i,
  /subtitles? (by|from)/i,
  /please subscribe/i,
  /like and subscribe/i,
  /^\s*(thank you|thanks|bye|you)\.?\s*$/i,
  /^\s*(धन्यवाद|शुक्रिया)[।.]?\s*$/,
  /amara\.org/i,
  /gracias por ver|subt[ií]tulos/i,
  /merci d'avoir regard[ée]|sous-titr/i,
  /untertitel|danke f[üu]rs zuschauen/i,
  /obrigad[oa] por assistir|legendas/i,
];

export const isHallucination = (t) => !t || HALLUCINATIONS.some((re) => re.test(t));

// Hindi words that are not also English words ("to", "the", "me", "main", "ho", "na" are left out on purpose).
const HINDI_WORDS = new Set(`hai hain tha thi ka ki ke ko se mein mai tu tum aap yaar yar nahi nahin kya bhai toh aur bola boli kaha
raha rahi rahe hum mera meri mere tera teri tere ye yeh wo woh vo ek kar karo chal acha accha theek haan bas phir fir abhi kyun`.split(/\s+/));
// A Hinglish speaker always uses some Hindi words; 6+ words with none at all = Whisper translated to English.
export function looksTranslated(text) {
  if (!text || hasNonLatin(text)) return false;
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  return words.length >= 6 && !words.some((w) => HINDI_WORDS.has(w));
}

async function stt(audio, mime, ext, model, language, prompt) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), `chunk.${ext}`);
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('language', language); // Hindi/Urdu are one spoken language; without this Whisper may pick Urdu script
  form.append('prompt', prompt);
  const res = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: form });
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { text = '' } = await res.json();
  return text.trim();
}

export async function transcribe(audio, mime, knownCharacters = [], language = 'hinglish') {
  const L = lang(language);
  const names = knownCharacters.length ? ` Characters: ${knownCharacters.join(', ')}.` : '';
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : mime.includes('aiff') ? 'aiff' : 'webm';
  const model = process.env.KALAM_STT_MODEL || 'whisper-large-v3';
  let clean = await stt(audio, mime, ext, model, L.whisper, `${L.prompt}${names}`);
  // Hindi/Hinglish but a long English sentence with not one Hindi word: Whisper translated instead of
  // transcribing. Ask the other Whisper model once more with the plain Hindi prompt, keep it if it's Hindi.
  if ((language === 'hinglish' || language === 'hindi') && looksTranslated(clean)) {
    try {
      const again = await stt(audio, mime, ext, model === 'whisper-large-v3' ? 'whisper-large-v3-turbo' : 'whisper-large-v3', L.whisper, L.prompt);
      if (hasNonLatin(again) || !looksTranslated(again)) clean = again;
    } catch {}
  }
  if (!clean || HALLUCINATIONS.some((re) => re.test(clean))) return '';
  // Hinglish only: Whisper sometimes writes Hindi script; Kalam always shows Roman.
  return language === 'hinglish' && hasNonLatin(clean) ? romanize(clean, knownCharacters) : clean;
}

// Devanagari (or stray Urdu) -> the Roman Hinglish a writer would actually type.
export async function romanize(text, knownCharacters = []) {
  const sys =
    'Convert this Hindi speech transcript into Roman-script Hinglish, the way an Indian screenwriter types it ' +
    '(e.g. "yaar main nahi aaunga", "kya kar raha hai"). English words that got written in Hindi script go back to ' +
    'normal English spelling (सीन→scene, कट टू→cut to, प्लेग्राउंड→playground, ऐक्शन→action, ओके→okay). ' +
    `Names: use these spellings when it is the same person: ${knownCharacters.map((n) => n.charAt(0) + n.slice(1).toLowerCase()).join(', ') || 'none yet'}. ` +
    'Write names with a capital first letter only (Priyam, not PRIYAM). ' +
    'Do NOT translate, do not add or drop words, keep punctuation. Reply with the converted text only.';
  for (const model of ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b']) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          reasoning_effort: model.startsWith('qwen/') ? 'none' : 'low',
          messages: [{ role: 'system', content: sys }, { role: 'user', content: text }],
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const out = (await res.json()).choices[0].message.content.trim().replace(/^["“]|["”]$/g, '');
      if (out && !hasNonLatin(out)) return out;
    } catch (err) {
      console.error(`[kalam] romanize ${model}:`, err.message);
    }
  }
  // Offline fallback: never leave Hindi/Urdu script on the page.
  return devanagariToRoman(text).replace(/[\u0600-\u06FF]+/g, '').replace(/\s+/g, ' ').trim();
}

// Each Groq model has its own rate-limit bucket (free tier: ~8k tokens a minute each, and one request is ~2k).
// Spreading requests over three models lets a free key keep up with fast dictation instead of
// dropping to "keywords (AI busy)". Primary first, then the others.
const MODELS = () => [process.env.KALAM_LLM_MODEL || 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "Please try again in 2.6s" / "in 772.5ms"
const retryAfter = (msg) => {
  const m = String(msg).match(/try again in ([\d.]+)(ms|s)/);
  return m ? Number(m[1]) * (m[2] === 'ms' ? 1 : 1000) : null;
};

// Cleanup pass when the writer stops the mic: the whole take at once, written from scratch.
const TAKE_NOTE = `
WHOLE TAKE: this time "chunk" is EVERYTHING the writer said in one go (the pieces joined in order), and
recentScript is the script just BEFORE they started. It was already written live piece by piece; now that you
can see all of it, write it again properly from scratch: return all the ops for the whole take, in order, as if
appending to the end of recentScript. Understand the whole story first (who is who, where the scene changes,
who says what). Editing commands inside the take ("galat ho gaya", "last line hata do", "isko aise likho …")
apply to what was said just before them in the take: carry them out and don't write them. Don't wait: never
return a "wait" op.
DON'T LOSE ANYTHING: every event, description and line that was said must be in your ops (only cue words,
fillers like "toh hua ye ki", and speech-recognition noise that clearly isn't part of the story are dropped).
Keep their words and language; only narration changes to present tense with names. E.g. "Tanmay table fix
kar raha tha aur main sofe pe leta hua tha" must stay as action: "Tanmay table fix kar raha hai aur MAIN sofe pe
leta hua hai." Times said ("raat ke gyarah baje") go in the action or the heading. Same INT/EXT rules as
always (chhat/terrace/roof → EXT.), and keep Hindi place words ("CHHAT", not "ROOF").`;

async function ask(model, payload) {
  const L = lang(payload.language);
  const body = {
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: (L.ai ? `${SYSTEM_PROMPT}\n\nLANGUAGE: ${L.ai}` : SYSTEM_PROMPT) + (payload.take ? `\n${TAKE_NOTE}` : '') },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  };
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  if (model.startsWith('qwen/')) body.reasoning_effort = 'none'; // no "thinking": faster, same answers here
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(payload.take ? 45000 : 20000),
  });
  if (!res.ok) throw new Error(`Groq LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return { ops: Array.isArray(parsed.ops) ? parsed.ops : [], model };
}

export async function interpret(payload) {
  const waits = [];
  let lastErr;
  for (const model of MODELS()) {
    try { return await ask(model, payload); } catch (err) {
      console.error(`[kalam] ${model}:`, err.message);
      lastErr = err;
      const w = retryAfter(err.message);
      if (w != null) waits.push({ model, w });
    }
  }
  // All busy: wait out the shortest rate-limit window (if short) and try that model once more.
  waits.sort((a, b) => a.w - b.w);
  if (waits[0] && waits[0].w <= 6000) {
    await sleep(waits[0].w + 150);
    return ask(waits[0].model, payload);
  }
  throw lastErr;
}
