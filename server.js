// Local server: serves the app UI and proxies Groq (key never reaches the page).
// Used by Electron (main.js) and standalone in a browser: `npm run web`.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from './lib/env.js';
import { transcribe, interpret, hasKey, romanize, isHallucination } from './lib/groq.js';
import { hasNonLatin, devanagariToRoman } from './lib/translit.js';

loadEnv();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };

// Which voice path to use: 'online' (Groq), 'offline' (whisper.cpp on this Mac) or null. Set by main.js;
// without it (npm run web) it's Groq whenever there's a key.
let voice = { route: () => (hasKey() ? 'online' : null), offline: null };
export function setVoice(v) { voice = v; }

// The Mac app passes a random per-launch token; /api/* then needs it in X-Kalam-Token.
// Other programs and web pages on this Mac can't use the customer's Groq key through us.
// (A custom header also forces a CORS preflight, which we never answer, so browsers block cross-origin calls.)
let token = null;
let hostOk = () => true;
const allowed = (req) => {
  if (!hostOk(req.headers.host)) return false; // DNS-rebinding guard
  if (!token) return true; // npm run web (development)
  const got = Buffer.from(String(req.headers['x-kalam-token'] || ''));
  const want = Buffer.from(token);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/') && !allowed(req)) return json(res, 403, { error: 'forbidden' });
    if (url.pathname === '/api/status') {
      const route = voice.route();
      return json(res, 200, { ai: route === 'online', voice: Boolean(route), route, key: hasKey() });
    }

    if (url.pathname === '/api/transcribe' && req.method === 'POST') {
      const route = voice.route();
      if (!route) return json(res, 400, { error: 'Voice is off. Add a Groq key or download offline voice in Settings (⌘,).' });
      const audio = await readBody(req);
      const lang = url.searchParams.get('lang') || 'en';
      if (route === 'offline') {
        // Offline: whisper.cpp, then the built-in Devanagari -> Roman (no AI involved).
        const raw = await voice.offline(audio, lang);
        const text = lang === 'hinglish' && hasNonLatin(raw) ? devanagariToRoman(raw).replace(/[\u0600-\u06FF]+/g, '').replace(/\s+/g, ' ').trim() : raw;
        return json(res, 200, { text: isHallucination(raw) || isHallucination(text) ? '' : text });
      }
      const names = (url.searchParams.get('names') || '').split(',').filter(Boolean);
      const text = await transcribe(audio, req.headers['content-type'] || 'audio/webm', names, lang);
      return json(res, 200, { text });
    }

    if (url.pathname === '/api/interpret' && req.method === 'POST') {
      if (voice.route() !== 'online') return json(res, 400, { error: 'AI is off in offline mode.' });
      const payload = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
      // Typed or transcribed Hindi script -> Roman first, so the page never gets Devanagari/Urdu.
      // (Hindi mode keeps Devanagari for what's written; names and sluglines are always Roman.)
      const devanagari = payload.language === 'hindi';
      if (!devanagari && hasNonLatin(payload.chunk || '')) payload.chunk = await romanize(payload.chunk, payload.knownCharacters || []);
      const out = await interpret(payload);
      for (const op of out.ops) for (const k of devanagari ? ['heading', 'character'] : ['text', 'heading', 'paren', 'character'])
        if (typeof op[k] === 'string' && hasNonLatin(op[k])) op[k] = devanagariToRoman(op[k]).replace(/[\u0600-\u06FF]+/g, '').trim();
      out.chunk = payload.chunk;
      return json(res, 200, out);
    }

    // static
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error('[kalam]', err.message);
    json(res, 500, { error: err.message });
  }
}

export function startServer(port = 0, opts = {}) {
  token = opts.token || null;
  return new Promise((resolve) => {
    const server = http.createServer(handle);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      if (token) hostOk = (h) => h === `127.0.0.1:${p}`;
      resolve(p);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = await startServer(Number(process.env.PORT) || 4517);
  console.log(`Kalam running at http://localhost:${port}  (AI: ${hasKey() ? 'on' : 'off — add GROQ_API_KEY'})`);
}
