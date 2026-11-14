// Offline voice: whisper.cpp's whisper-server (ships inside the app, a few MB) + a Whisper model the user
// downloads once from Settings (not bundled). Runs on this Mac with Metal; nothing leaves the machine.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lang } from '../public/languages.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// large-v3-turbo is the smallest Whisper that is decent at Hindi/Hinglish. q5_0 quantised = 574 MB.
export const MODEL = {
  file: 'ggml-large-v3-turbo-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
  size: 574041195,
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
};


let dir = null; // userData/models
export function init(userData) { dir = path.join(userData, 'models'); }
const modelPath = () => path.join(dir, MODEL.file);

// Packaged: Contents/Resources/whisper/whisper-server. Development: vendor/whisper/bin (scripts/build-whisper.sh).
export function binaryPath() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'whisper', 'whisper-server');
  if (packaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(here, '..', 'vendor', 'whisper', 'bin', 'whisper-server');
  return fs.existsSync(dev) ? dev : null;
}

export const hasModel = () => Boolean(dir) && fs.existsSync(modelPath());
export const ready = () => hasModel() && Boolean(binaryPath());

/* ───────────── download ───────────── */
let job = null; // { received, total, controller, error }

export function downloadState() {
  if (job) return { state: job.error ? 'error' : 'downloading', received: job.received, total: job.total, error: job.error };
  return { state: hasModel() ? 'ready' : 'none', total: MODEL.size };
}

export function download(onProgress) {
  if (job && !job.error) return;
  const controller = new AbortController();
  job = { received: 0, total: MODEL.size, controller, error: null };
  const part = `${modelPath()}.part`;
  (async () => {
    await fsp.mkdir(dir, { recursive: true });
    const res = await fetch(MODEL.url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    job.total = Number(res.headers.get('content-length')) || MODEL.size;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let last = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      job.received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 250) { last = Date.now(); onProgress(downloadState()); }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if (hash.digest('hex') !== MODEL.sha256) throw new Error('Download was corrupted. Try again.');
    await fsp.rename(part, modelPath());
    job = null;
    onProgress(downloadState());
  })().catch(async (err) => {
    await fsp.rm(part, { force: true }).catch(() => {});
    if (controller.signal.aborted) job = null;
    else if (job) job.error = /fetch failed|ENOTFOUND|ECONN/i.test(err.message) ? 'No internet. Try again when you’re online.' : err.message;
    onProgress(downloadState());
  });
}

export function cancelDownload() { job?.controller.abort(); }

export async function removeModel() {
  stop();
  await fsp.rm(modelPath(), { force: true });
}

/* ───────────── whisper-server ───────────── */
let proc = null;
let port = 0;
let procLang = null; // the server is started for one language; switching restarts it
let starting = null;
let idleTimer = null;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function start(code) {
  if (proc && procLang !== code) stop();
  if (proc) return;
  if (starting) return starting;
  starting = (async () => {
    const bin = binaryPath();
    if (!bin || !hasModel()) throw new Error('Offline voice isn’t installed. Download it in Settings.');
    port = await freePort();
    const L = lang(code);
    procLang = code;
    proc = spawn(bin, ['-m', modelPath(), '--host', '127.0.0.1', '--port', String(port), '-l', L.whisper, '-nt', '--prompt', L.prompt], { stdio: 'ignore' });
    proc.once('exit', () => { proc = null; });
    // The model takes a few seconds to load.
    for (let i = 0; i < 120 && proc; i++) {
      try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); return; } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    stop();
    throw new Error('Offline voice didn’t start.');
  })().finally(() => { starting = null; });
  return starting;
}

export function stop() {
  proc?.kill();
  proc = null;
}

// Frees ~1 GB of memory when the writer stops dictating for a while.
function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stop, 10 * 60 * 1000);
  idleTimer.unref?.();
}

// wav (16 kHz mono, made by the page) -> raw transcript (often Devanagari; the caller romanises it).
export async function transcribe(wav, code = 'hinglish') {
  const L = lang(code);
  await start(code);
  touch();
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('language', L.whisper);
  form.append('prompt', L.prompt);
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Offline voice ${res.status}`);
  const { text = '' } = await res.json();
  return text.trim();
}
