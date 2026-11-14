import { Script } from './fountain.js';
import { interpretRules, NARRATION, matchKnown, normalizeNames, castFromScript, phoneKey, nameKey } from './rules.js';
import { Recorder } from './recorder.js';
import { toWav16k } from './wav.js';
import { alignHindi, opsToDevanagari } from './hindi.js';
import { buildItems, paginate, measure, renderPrint } from './paginate.js';

/* ════════════════════════════════════════════════════════════════════
   Kalam — the page is ONE editable document of Fountain lines (like Beat).
   Every line is <div class="ln" data-t="TYPE">. Types are derived from text.
   Keyboard edits go through execCommand so native undo keeps working.
   Voice edits insert at the cursor (like Wispr) and have their own undo.
   ════════════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const page = $('page');
const desk = $('desk');
const fs = window.kalamFS; // Electron only
// Mac app: the local server's /api/* needs this per-launch token (browser dev mode: none).
const API = window.kalamApi?.token ? { 'X-Kalam-Token': window.kalamApi.token } : {};
const STORE = 'kalam.doc.v2';
const PREFS = 'kalam.prefs.v1';
const BLOCK = new Set(['character', 'paren', 'dialogue']);
const TYPE_LABEL = {
  scene: 'Scene heading', action: 'Action', character: 'Character', dialogue: 'Dialogue', paren: 'Parenthetical',
  transition: 'Transition', blank: 'Action', section: 'Section', synopsis: 'Synopsis', note: 'Note', boneyard: 'Boneyard',
  centered: 'Centered', pagebreak: 'Page break', lyrics: 'Lyrics',
};
const TIMES = ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'AFTERNOON', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME TIME', 'DAWN', 'DUSK'];

let meta = { title: '', credit: '', author: '', source: '', draft: '', contact: '' };
let filePath = null;
let prefs = { theme: null, outline: false, focus: false, typewriter: false, sceneNums: true, breaks: true, ai: true, lang: 'en' };
let aiAvailable = false;   // AI understanding (Groq LLM)
let voiceAvailable = false; // mic: Groq Whisper, or offline whisper.cpp
let voiceRoute = null;      // 'online' | 'offline' | null
let carry = '';
let pendingScene = false;
let forceAction = false;
let chain = Promise.resolve();
let voiceUndo = [];
let typedSinceVoice = true;
let lastCaret = null;

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (s = '', n = 70) => (s.length > n ? `${s.slice(0, n)}…` : s);
const ALLCAPS = (t) => /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t.replace(/\(.*?\)/g, ''));
const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i;
const exec = (cmd, val) => document.execCommand(cmd, false, val);
const isMac = /Mac/.test(navigator.platform);

/* ───────────────────────── classification ───────────────────────── */
function classify(lines, forced = []) {
  const types = [];
  let inBone = false;
  lines.forEach((s, i) => {
    const t = s.trim();
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const prev = types[i - 1];
    let type = 'action';
    if (inBone) { type = 'boneyard'; if (t.includes('*/')) inBone = false; }
    else if (t.startsWith('/*')) { type = 'boneyard'; if (!t.includes('*/')) inBone = true; }
    else if (!t) type = 'blank';
    else if (/^\[\[.*\]\]$/.test(t)) type = 'note';
    else if (/^={3,}$/.test(t)) type = 'pagebreak';
    else if (t.startsWith('#')) type = 'section';
    else if (/^=(?!=)/.test(t)) type = 'synopsis';
    else if (/^>.*<$/.test(t)) type = 'centered';
    else if (t.startsWith('~')) type = 'lyrics';
    else if (prevBlank && (/^\.(?!\.)/.test(t) || SCENE_RE.test(t))) type = 'scene';
    else if (prevBlank && (/^>/.test(t) || /^[A-Z0-9 ]+TO:$/.test(t))) type = 'transition';
    else if (!prevBlank && BLOCK.has(prev)) type = t.startsWith('(') ? 'paren' : 'dialogue';
    else if (prevBlank && !t.startsWith('!') && (t.startsWith('@') || ALLCAPS(t))) type = 'character';
    if (forced[i] && (type === 'action' || type === 'blank')) type = forced[i];
    types.push(type);
  });
  return types;
}

/* ───────────────────────── DOM ⇄ lines ───────────────────────── */
const lineDivs = () => [...page.children];
function forcedText(t, force) {
  const s = t.trim();
  if (!s || !force) return t;
  if (force === 'character') return t.toUpperCase();
  if (force === 'scene') return SCENE_RE.test(s) ? t.toUpperCase() : `.${s.replace(/^\./, '').toUpperCase()}`;
  if (force === 'transition') return /TO:$/i.test(s) ? s.toUpperCase() : `> ${s.replace(/^>\s*/, '').toUpperCase()}`;
  return t;
}
function getLines() {
  return lineDivs().map((d) => forcedText(d.textContent.replace(/​/g, ''), d.dataset.force));
}
function currentTypes() {
  return classify(lineDivs().map((d) => d.textContent), lineDivs().map((d) => d.dataset.force));
}
function setLines(lines, fresh = new Set()) {
  if (!lines.length) lines = [''];
  const types = classify(lines);
  page.replaceChildren(...lines.map((l, i) => {
    const d = document.createElement('div');
    d.className = `ln${fresh.has(i) ? ' fresh' : ''}`;
    d.dataset.t = types[i];
    if (l) d.textContent = l;
    else d.append(document.createElement('br'));
    return d;
  }));
  afterChange();
}
function restyle() {
  const divs = lineDivs();
  const types = currentTypes();
  divs.forEach((d, i) => {
    if (!d.classList.contains('ln')) d.classList.add('ln');
    if (d.dataset.t !== types[i]) d.dataset.t = types[i];
    const t = d.textContent.trim();
    if (d.dataset.force && t && types[i] !== d.dataset.force) delete d.dataset.force;
  });
}
function normalize() {
  const bad = [...page.childNodes].some((n) => n.nodeType !== 1 || n.tagName !== 'DIV' || n.querySelector('div,p'));
  if (!bad) return;
  const c = getCaret();
  setLines(page.innerText.replace(/\n$/, '').split('\n'));
  if (c) setCaret(c.line, c.offset);
}

/* ───────────────────────── caret ───────────────────────── */
function lineOf(node) {
  while (node && node.parentNode !== page) node = node.parentNode;
  return node;
}
function getCaret(which = 'start') {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const node = which === 'end' ? r.endContainer : r.startContainer;
  const off = which === 'end' ? r.endOffset : r.startOffset;
  if (!page.contains(node)) return null;
  if (node === page) {
    const i = Math.max(0, Math.min(off, page.children.length - 1));
    return { line: i, offset: 0 };
  }
  const ln = lineOf(node);
  const pre = document.createRange();
  pre.selectNodeContents(ln);
  pre.setEnd(node, off);
  return { line: lineDivs().indexOf(ln), offset: pre.toString().length };
}
function pointAt(line, offset) {
  const ln = page.children[Math.max(0, Math.min(line, page.children.length - 1))];
  const walker = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT);
  let rem = offset;
  let n;
  let last = null;
  while ((n = walker.nextNode())) {
    last = n;
    if (rem <= n.length) return [n, rem];
    rem -= n.length;
  }
  return last ? [last, last.length] : [ln, 0];
}
function setCaret(line, offset, endLine, endOffset) {
  if (!page.children.length) return;
  const r = document.createRange();
  r.setStart(...pointAt(line, offset));
  if (endLine != null) r.setEnd(...pointAt(endLine, endOffset));
  else r.collapse(true);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  lastCaret = { line, offset };
}
function selectLine(i) {
  const d = page.children[i];
  setCaret(i, 0, i, d.textContent.length);
}
// Replace a whole line's text through the editing pipeline (keeps native undo).
function replaceLine(i, text) {
  const d = page.children[i];
  if (d.textContent === text) return;
  selectLine(i);
  if (text) exec('insertText', text);
  else exec('delete');
}
function caretAtEnd() {
  const lines = getLines();
  return { line: lines.length - 1, offset: lines[lines.length - 1].length };
}

/* ───────────────────────── script model at the caret ───────────────────────── */
function docAtCaret(lines = getLines(), caret = lastCaret, fa = forceAction) {
  const s = Script.fromFountain(lines.join('\n'), { titlePage: false });
  s.cursor = null;
  const c = caret && caret.line < lines.length ? caret : null;
  if (c) {
    let end = c.line;
    while (end + 1 < lines.length && lines[end + 1].trim()) end++;
    if (lines.slice(end + 1).some((l) => l.trim())) {
      s.cursor = Script.fromFountain(lines.slice(0, end + 1).join('\n'), { titlePage: false }).els.length;
    }
  }
  s.forceAction = fa;
  return s;
}

/* ───────────────────────── after any change ───────────────────────── */
let sideTimer;
function afterChange() {
  page.classList.toggle('is-empty', getLines().every((l) => !l.trim()));
  clearTimeout(sideTimer);
  sideTimer = setTimeout(() => { renderOutline(); renderMode(); renderBreaks(); renderStatus(); markCurrent(); }, 140);
  persistSoon();
}

/* ───────────────────────── outline & stats ───────────────────────── */
let outlineTab = 'scenes';
function analyse() {
  const lines = getLines();
  const types = classify(lines);
  const scenes = [];
  const chars = {};
  let words = 0;
  types.forEach((t, i) => {
    const s = lines[i].trim();
    if (t === 'scene') scenes.push({ i, text: s.replace(/^\./, ''), syn: '' });
    if (t === 'synopsis' && scenes.length) scenes[scenes.length - 1].syn = s.replace(/^=\s*/, '');
    if (t === 'section') scenes.push({ i, text: s.replace(/^#+\s*/, ''), section: true });
    if (t === 'character') {
      const n = s.replace(/^@/, '').replace(/\s*\(.*\)\s*/g, '').replace(/\s*\^$/, '').trim().toUpperCase();
      chars[n] = chars[n] || { lines: 0, words: 0 };
      chars[n].lines++;
      let j = i + 1;
      while (j < lines.length && (types[j] === 'dialogue' || types[j] === 'paren')) {
        if (types[j] === 'dialogue') chars[n].words += lines[j].split(/\s+/).filter(Boolean).length;
        j++;
      }
    }
    if (!['note', 'boneyard', 'synopsis', 'section', 'blank'].includes(t)) words += s.split(/\s+/).filter(Boolean).length;
  });
  return { lines, types, scenes, chars, words };
}
function currentSceneLine() {
  const c = getCaret() || lastCaret;
  if (!c) return -1;
  const types = currentTypes();
  for (let i = c.line; i >= 0; i--) if (types[i] === 'scene') return i;
  return -1;
}
function renderOutline() {
  const { scenes, chars } = analyse();
  const here = currentSceneLine();
  let n = 0;
  $('sceneList').innerHTML = scenes.length
    ? scenes.map((s) => s.section
      ? `<li class="sec" data-i="${s.i}">${esc(s.text)}</li>`
      : `<li data-i="${s.i}" class="${s.i === here ? 'here' : ''}"><span class="n">${++n}</span><span class="h">${esc(s.text)}${s.syn ? `<span class="syn">${esc(s.syn)}</span>` : ''}</span></li>`).join('')
    : '<li class="muted" style="cursor:default">Scenes appear here as you write.</li>';
  const entries = Object.entries(chars).sort((a, b) => b[1].lines - a[1].lines);
  const max = entries[0]?.[1].lines || 1;
  $('charList').innerHTML = entries.length
    ? entries.map(([name, v]) => `<li><div style="flex:1;min-width:0"><div class="h">${esc(name)}</div><div class="bar" style="width:${Math.max(6, (v.lines / max) * 100)}%"></div></div><span>${v.lines}</span></li>`).join('')
    : '<li class="muted">Characters appear here once they speak.</li>';
}
let pagination = { pages: [[]], starts: [0] };
function computePages() {
  const { lines, types } = analyse();
  const pages = paginate(measure(buildItems(lines, types), $('measure')));
  pagination = { pages, starts: pages.map((p) => p.find((it) => it.type !== 'blank')?.i ?? 0) };
  return pages;
}
function renderBreaks() {
  computePages();
  const html = [];
  pagination.starts.forEach((i, n) => {
    if (n === 0) return;
    const d = page.children[i];
    if (d) html.push(`<div class="brk" style="top:${page.offsetTop + d.offsetTop - 8}px"><span>${n + 1}.</span></div>`);
  });
  $('breaks').innerHTML = html.join('');
}
function renderStatus() {
  const pages = pagination.pages.length;
  const { scenes, words } = analyse();
  const c = getCaret() || lastCaret;
  const cur = c ? Math.max(1, pagination.starts.filter((i) => i <= c.line).length) : 1;
  const sceneCount = scenes.filter((s) => !s.section).length;
  $('pageInfo').textContent = `Page ${cur} of ${pages}`;
  $('stats').innerHTML = [
    ['Pages', pages], ['Runtime', `~${pages} min`], ['Scenes', sceneCount], ['Words', words.toLocaleString()],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const types = currentTypes();
  const t = c ? types[c.line] : 'action';
  const d = c && page.children[c.line];
  const label = d && !d.textContent.trim() && !d.dataset.force && t === 'blank' ? 'Action' : TYPE_LABEL[t] || 'Action';
  $('elType').textContent = label;
}
$('sceneList').onclick = (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  const i = Number(li.dataset.i);
  const d = page.children[i];
  if (!d) return;
  desk.scrollTo({ top: d.offsetTop + page.offsetTop - 90, behavior: 'smooth' });
  page.focus();
  setCaret(i, d.textContent.length);
};
document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => {
  outlineTab = b.dataset.tab;
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  $('sceneList').hidden = outlineTab !== 'scenes';
  $('charList').hidden = outlineTab !== 'chars';
}));

/* ───────────────────────── voice mode pill ───────────────────────── */
function renderMode() {
  const s = docAtCaret();
  const m = s.mode;
  const pill = $('modePill');
  pill.className = 'vmode';
  if (carry || pendingScene) { pill.textContent = 'Waiting for the location…'; pill.classList.add('wait'); }
  else if (m.mode === 'dialogue') { pill.textContent = `Next: ${m.character} speaking`; pill.classList.add('dialogue'); }
  else pill.textContent = 'Next: action';
  $('cursorPill').hidden = s.cursor == null;
}

/* ───────────────────────── title page ───────────────────────── */
const META_KEYS = { title: 'Title', credit: 'Credit', author: 'Author', source: 'Source', draft: 'Draft date', contact: 'Contact' };
function titlePageText() {
  if (!meta.title && !meta.author) return '';
  const out = [];
  for (const [k, label] of Object.entries(META_KEYS)) {
    const v = (meta[k] || '').trim();
    if (!v) continue;
    if (v.includes('\n')) out.push(`${label}:`, ...v.split('\n').map((l) => `    ${l}`));
    else out.push(`${label}: ${v}`);
  }
  return `${out.join('\n')}\n\n`;
}
function parseTitlePage(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const m = { title: '', credit: '', author: '', source: '', draft: '', contact: '' };
  if (!/^[A-Za-z][A-Za-z ]*:/.test(lines[0] || '')) return { meta: m, body: text };
  const rev = Object.fromEntries(Object.entries(META_KEYS).map(([k, v]) => [v.toLowerCase(), k]));
  rev.authors = 'author';
  let key = null;
  let i = 0;
  for (; i < lines.length && lines[i].trim(); i++) {
    const kv = lines[i].match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
    if (kv && !/^\s/.test(lines[i])) {
      key = rev[kv[1].trim().toLowerCase()] || null;
      if (key) m[key] = kv[2].trim();
    } else if (key) m[key] = (m[key] ? `${m[key]}\n` : '') + lines[i].trim();
  }
  return { meta: m, body: lines.slice(i + 1).join('\n').replace(/^\n+/, '') };
}
function renderTitleSheet() {
  $('title').value = meta.title;
  const show = Boolean(meta.title && (meta.author || meta.credit || meta.contact || meta.draft));
  const ts = $('titleSheet');
  ts.hidden = !show;
  if (!show) return;
  const clean = (s) => esc(s).replace(/\*\*|\*|_/g, '');
  ts.innerHTML = `
    <div class="tp-main">
      <div class="tp-title">${clean(meta.title)}</div><div class="tp-gap"></div>
      ${meta.credit ? `<div>${clean(meta.credit)}</div>` : '<div>Written by</div>'}<div class="tp-gap"></div>
      <div>${clean(meta.author)}</div>
      ${meta.source ? `<div class="tp-gap"></div><div>${clean(meta.source)}</div>` : ''}
    </div>
    <div class="tp-bottom"><div>${clean(meta.contact)}</div><div>${clean(meta.draft)}</div></div>`;
}
function openTitleDialog() {
  const f = $('titleForm');
  for (const k of Object.keys(META_KEYS)) f.elements[k].value = meta[k] || '';
  $('titleDlg').showModal();
}
$('titleDlg').addEventListener('close', () => {
  if ($('titleDlg').returnValue !== 'ok') return;
  const f = $('titleForm');
  for (const k of Object.keys(META_KEYS)) meta[k] = f.elements[k].value.trim();
  renderTitleSheet();
  persistSoon();
});
$('titleSheet').onclick = openTitleDialog;
$('title').addEventListener('input', () => { meta.title = $('title').value; renderTitleSheet(); persistSoon(); });

/* ───────────────────────── persistence ───────────────────────── */
const fullText = () => `${titlePageText()}${getLines().join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
let saveTimer;
function persistSoon() {
  $('saved').textContent = 'Edited';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { localStorage.setItem(STORE, JSON.stringify({ meta, text: getLines().join('\n'), filePath })); } catch {}
    if (fs && filePath) await fs.save({ path: filePath, text: fullText() });
    $('saved').textContent = filePath ? 'Saved' : 'Saved on this device';
  }, 600);
}
function loadStored() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const d = JSON.parse(raw);
      if (!d.meta) d.meta = { ...meta, title: d.title || '' };
      return d;
    }
  } catch {}
  return { meta, text: '' };
}
function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) || 'null');
    // Writers from before the language picker were dictating Hinglish; keep that for them.
    if (saved && !('lang' in saved)) saved.lang = 'hinglish';
    Object.assign(prefs, saved || {});
  } catch {}
}
function savePrefs() {
  try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch {}
}
function snapshot() {
  return { lines: getLines(), meta: { ...meta }, caret: lastCaret, forceAction };
}
function restoreSnap(snap) {
  meta = { ...snap.meta };
  renderTitleSheet();
  forceAction = snap.forceAction;
  setLines(snap.lines);
  if (snap.caret) setCaret(snap.caret.line, snap.caret.offset);
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1800);
}

/* ───────────────────────── voice log ───────────────────────── */
const OP_LABEL = {
  scene: (o) => `<b>Scene</b> ${esc(o.heading)}`,
  action: (o) => `<b>Action</b> ${esc(short(o.text))}`,
  dialogue: (o) => `<b>${esc(o.character)}</b>${o.paren ? ` (${esc(o.paren)})` : ''}${o.text ? ` “${esc(short(o.text))}”` : ' …'}`,
  append: (o) => `<b>+</b> ${esc(short(o.text))}`,
  paren: (o) => `<b>Parenthetical</b> (${esc(o.text)})`,
  transition: (o) => `<b>${esc(o.text)}</b>`,
  delete_last: () => '<b>Removed</b> last line',
  replace_last: (o) => `<b>Changed</b> → ${esc(short(o.text))}`,
  rename: (o) => `<b>Renamed</b> ${esc(o.from)} → ${esc(o.to)}`,
  end_dialogue: () => '<b>End of dialogue</b>',
  wait: () => '<b>…keep going</b>',
  wait_scene: () => '<b>…say the location</b>',
};
function logItem(text) {
  $('log').querySelector('.empty')?.remove();
  const li = document.createElement('li');
  li.innerHTML = `<div class="heard">${esc(text)}</div><div class="did">…</div>`;
  $('log').prepend(li);
  while ($('log').children.length > 80) $('log').lastChild.remove();
  return li;
}
$('btnLog').onclick = () => {
  const p = $('logPop');
  p.hidden = !p.hidden;
  $('voice').classList.toggle('open', !p.hidden);
};
$('btnCopyLog').onclick = async () => {
  const text = [...$('log').children].filter((li) => li.querySelector('.heard')).reverse()
    .map((li) => `🎙 ${li.querySelector('.heard').innerText}\n→ ${li.querySelector('.did').innerText}`).join('\n\n');
  try { await (window.kalamFS?.copy ?? ((t) => navigator.clipboard.writeText(t)))(`${text}\n\n--- SCRIPT ---\n${fullText()}`); toast('Log + script copied'); }
  catch { toast('Copy failed'); }
};

/* ───────────────────────── voice pipeline ───────────────────────── */
function lastOtherCharacter(s) {
  const cur = s.mode.character;
  for (let i = s.at - 1; i >= 0; i--) {
    const e = s.els[i];
    if (e.type === 'character') { const n = e.text.replace(/\s*\(.*\)/, ''); if (n !== cur) return n; }
    if (e.type === 'scene') break;
  }
  return null;
}
const NON_LATIN = /[ऀ-ॿ؀-ۿ]/;

let lastChunk = ''; // what was said just before (stories run across chunks)
async function interpretChunk(chunk, s) {
  const m = s.mode;
  const known = s.characters();
  // Names from the action lines too ("Do log hain, Priyam aur Tanmay"), and fix misheard ones ("Tan mein" -> Tanmay).
  const cast = castFromScript(s.els);
  chunk = normalizeNames(chunk, known, cast);
  const ctx = { ...m, knownCharacters: known, lastOther: lastOtherCharacter(s), pendingScene, cast, narrator: meta.narrator || '' };
  // Hindi (Devanagari): find cues in a Roman copy, write back the Devanagari that was said.
  const hindi = prefs.lang === 'hindi' && /[ऀ-ॿ]/.test(chunk) ? alignHindi(chunk) : null;
  const rulesOps = hindi ? opsToDevanagari(interpretRules(hindi.roman, ctx), hindi.back) : interpretRules(chunk, ctx);
  const mentionsKnown = (chunk.match(/[\p{L}'-]+/gu) || []).some((w) => matchKnown(w, known));
  // Only a plain continuation of someone's line skips the AI. Plain narration in action mode goes to the AI,
  // because the writer may be telling the scene as a story ("pehle hum flat pe the, phir maine bola ki…").
  const plain =
    m.mode === 'dialogue' &&
    rulesOps.length > 0 && rulesOps.every((o) => o.op === 'append') && !pendingScene && !mentionsKnown &&
    !/^\s*\p{Lu}[\p{L}'-]+\s*[,:]/u.test(chunk) && !NON_LATIN.test(chunk) &&
    !(m.mode === 'dialogue' && NARRATION.test(chunk));
  const aiOn = prefs.ai && aiAvailable;
  if (!aiOn) return { ops: rulesOps, via: 'keywords' };
  if (plain) return { ops: rulesOps, via: 'direct' };
  try {
    const recent = new Script();
    recent.els = s.els.slice(Math.max(0, s.at - 10), s.at);
    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...API },
      body: JSON.stringify({
        language: prefs.lang || 'en', recentScript: recent.toFountain(), mode: m.mode, currentCharacter: m.character,
        knownCharacters: known, pendingScene, chunk, narrator: meta.narrator || '', previousChunk: lastChunk,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return { ops: fixNameSpelling(data.ops, known, cast), via: 'AI' };
  } catch (err) {
    console.warn('AI failed, using keywords', err);
    return { ops: rulesOps, via: 'keywords (AI busy)' };
  }
}

// A new character the action lines spelt differently ("Tanme" before, now TANMAY said clearly):
// rename the old spelling everywhere so the script uses one name.
function fixNameSpelling(ops, known, cast) {
  // Renames go last, so they also fix this chunk's own lines (the AI tends to put them first).
  const out = [...ops.filter((o) => o.op !== 'rename'), ...ops.filter((o) => o.op === 'rename')];
  for (const op of ops) {
    if (op.op !== 'dialogue' || !op.character || matchKnown(op.character, known)) continue;
    const old = cast.find((n) => phoneKey(n) === phoneKey(op.character) && nameKey(n) !== nameKey(op.character));
    if (old && !out.some((o) => o.op === 'rename' && nameKey(o.from || '') === nameKey(old)))
      out.push({ op: 'rename', from: old.toUpperCase(), to: op.character.toUpperCase() }); // last, so it also fixes this chunk's lines
  }
  return out;
}

function applyOps(ops, s) {
  const known = s.characters();
  const before = s.els.length;
  let changed = false;
  for (const op of ops) {
    if (op.op === 'wait' || op.op === 'wait_scene') continue;
    if (op.character) op.character = matchKnown(op.character, known) || op.character;
    if (op.op === 'rename' && op.from) op.from = matchKnown(op.from, known) || op.from;
    s.apply(op);
    changed = true;
  }
  if (!changed) return;
  forceAction = s.forceAction;
  const added = Math.max(0, s.els.length - before);
  const linesOf = (els) => {
    if (!els.length) return 0;
    const t = new Script();
    t.els = els;
    return t.toFountain().replace(/\n+$/, '').split('\n').length;
  };
  const body = s.toFountain().replace(/\n+$/, '');
  const lines = body ? body.split('\n') : [''];
  const caretLine = Math.max(0, linesOf(s.els.slice(0, s.at)) - 1);
  const firstNew = added ? linesOf(s.els.slice(0, s.at - added)) : caretLine;
  const fresh = new Set();
  for (let i = firstNew; i <= caretLine; i++) if (lines[i]?.trim()) fresh.add(i);
  const hadFocus = document.activeElement === page;
  setLines(lines, fresh);
  lastCaret = { line: caretLine, offset: lines[caretLine].length };
  if (hadFocus) setCaret(lastCaret.line, lastCaret.offset);
  const d = page.children[caretLine];
  if (d) desk.scrollTo({ top: d.offsetTop + page.offsetTop - desk.clientHeight / 2, behavior: 'smooth' });
}

async function handleText(text, li) {
  const chunk = `${carry} ${text}`.trim();
  carry = '';
  const s0 = docAtCaret();
  $('micState').textContent = recorder.active ? 'Listening…' : 'Thinking…';
  const { ops, via } = await interpretChunk(chunk, s0);
  lastChunk = chunk;
  if (take) {
    take.chunks.push(text);
    if (/keywords/.test(via)) take.fellBack = true;
    if (ops.some((o) => ['delete_last', 'replace_last', 'rename'].includes(o.op))) take.edited = true;
  }
  // Story-telling: "maine bola…" is the narrator. Known → use the name; unknown → MAIN until we ask.
  if (meta.narrator) for (const op of ops) if (op.character && /^MAIN$/i.test(op.character)) op.character = meta.narrator;
  const s = docAtCaret();
  const wasPending = pendingScene;
  pendingScene = false;
  const snap = snapshot();
  for (const op of ops) {
    if (op.op === 'wait') carry = chunk;
    if (op.op === 'wait_scene') pendingScene = true;
  }
  if (wasPending && !ops.some((o) => o.op === 'scene') && !carry && !pendingScene) pendingScene = false;
  if (ops.some((o) => o.op !== 'wait' && o.op !== 'wait_scene')) {
    voiceUndo.push(snap);
    if (voiceUndo.length > 100) voiceUndo.shift();
    typedSinceVoice = false;
  }
  applyOps(ops, s);
  renderMode();
  if (!recorder.active) $('micState').textContent = idleLabel();
  if (!meta.narrator && getLines().some((l) => /^MAIN( \(.*\))?$/.test(l))) askNarrator();
  li.querySelector('.did').innerHTML = ops.length
    ? `${ops.map((o) => (OP_LABEL[o.op] || (() => esc(o.op)))(o)).join(' · ')} <span class="muted">· ${via}</span>`
    : `<span class="muted">nothing to write · ${via}</span>`;
}
const enqueue = (fn) => (chain = chain.then(fn).catch((e) => console.error(e)));

/* ───────────── who is "main"? (story-telling in the first person) ───────────── */
function askNarrator() {
  if (!$('whoMain').hidden) return;
  const s = docAtCaret();
  // People already talking to "main" can't be "main"; offer the other names in the story.
  const speaking = new Set(s.characters());
  const names = [...new Set(castFromScript(s.els).map((n) => n.toUpperCase()))].filter((n) => !speaking.has(n) && n !== 'MAIN').slice(0, 4);
  $('whoChips').innerHTML = names.map((n) => `<button type="button" data-name="${esc(n)}">${esc(n.charAt(0) + n.slice(1).toLowerCase())}</button>`).join('');
  $('whoMain').hidden = false;
}
function setNarrator(name) {
  const n = name.trim().toUpperCase();
  if (!n) return;
  meta.narrator = n;
  $('whoMain').hidden = true;
  $('whoInput').value = '';
  // Replace the placeholder MAIN (always all caps) in cues and action. The Hindi word "main" ("I") is never
  // all caps, so lines like "main yahin hoon" stay untouched.
  const lines = getLines();
  let changed = false;
  lines.forEach((l, i) => {
    const m = l.match(/^MAIN( \(.*\))?$/);
    if (m && !(lines[i - 1] || '').trim()) { lines[i] = n + (m[1] || ''); changed = true; }
    else if (/\bMAIN\b/.test(l)) { lines[i] = l.replace(/\bMAIN\b/g, n); changed = true; }
  });
  if (changed) {
    // Re-rendering moves the browser's cursor to the top; keep writing where we were.
    const keep = lastCaret;
    const hadFocus = document.activeElement === page;
    setLines(lines);
    if (keep) { lastCaret = keep; if (hadFocus) setCaret(keep.line, keep.offset); }
  }
  persistSoon();
  toast(`“Main” is ${n.charAt(0) + n.slice(1).toLowerCase()} in this script`);
}
$('whoChips').onclick = (e) => { const b = e.target.closest('button'); if (b) setNarrator(b.dataset.name); };
$('whoForm').onsubmit = (e) => { e.preventDefault(); setNarrator($('whoInput').value); };

function onAudio(blob) {
  const li = logItem('🎙 …');
  // Whisper spells names right when it's told them: characters plus names written in the action lines.
  const doc = docAtCaret();
  const names = encodeURIComponent([...new Set([...doc.characters(), ...castFromScript(doc.els).map((n) => n.toUpperCase())])].slice(0, 16).join(','));
  // Offline voice (whisper.cpp) needs WAV; Groq takes the recording as is.
  const audio = voiceRoute === 'offline' ? toWav16k(blob) : Promise.resolve(blob);
  const transcript = audio.then((b) => fetch(`/api/transcribe?names=${names}&lang=${encodeURIComponent(prefs.lang || 'en')}`, {
    method: 'POST', headers: { 'Content-Type': b.type || 'audio/webm', ...API }, body: b,
  }))
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d.text; });
  enqueue(async () => {
    let text;
    try { text = await transcript; } catch (e) {
      li.querySelector('.did').innerHTML = `<span class="err">Couldn't transcribe: ${esc(e.message)}</span>`;
      return;
    }
    if (!text) { li.remove(); return; }
    li.querySelector('.heard').textContent = text;
    await handleText(text, li);
  });
}

const recorder = new Recorder({
  onChunk: onAudio,
  onLevel: (lvl) => { $('meter').style.transform = `scale(${1 + Math.min(0.35, lvl * 4)})`; },
  onState: (st) => {
    $('voice').classList.toggle('live', st !== 'off');
    $('micState').textContent = { off: recorder.active ? 'Listening…' : idleLabel(), listening: 'Listening…', hearing: 'Hearing you' }[st];
    if (st === 'off') $('meter').style.transform = '';
  },
});
async function toggleMic() {
  if (!voiceAvailable) { needAI('Voice needs a GROQ_API_KEY in Kalam/.env'); return; }
  try {
    if (recorder.active) {
      recorder.stop();
      // The last piece is still on its way (the recorder flushes it); clean up after it lands.
      const t = take;
      if (t) setTimeout(() => enqueue(() => cleanupTake(t)), 900);
    } else {
      await recorder.start();
      take = { before: snapshot(), chunks: [], fellBack: false, edited: false, typed: false };
    }
  } catch (e) { toast(`Microphone unavailable: ${e.message}`); }
}

/* ───────────── cleanup pass: when the mic stops, write the whole take again, understood as one ─────────────
   Live, each pause is converted on its own. A story told over a minute is better understood whole, and it
   costs one AI request instead of many. Runs only when the keyword engine had to fill in during the take (AI busy
   or off); skipped offline, for a single piece, or after hand edits / voice edit commands. ⌘Z = the live version. */
let take = null;

async function cleanupTake(t) {
  if (take !== t) return; // a new take started meanwhile
  take = null;
  const said = t.chunks.join(' ').replace(/\s+/g, ' ').trim();
  if (t.chunks.length < 2 || t.typed || t.edited || !aiAvailable || !prefs.ai || voiceRoute !== 'online') return;
  // Only when the keyword engine had to fill in (AI busy or off) during the take. When the AI wrote every piece
  // live, the live version is already as good (tested), and a rewrite would only cost a request.
  if (!t.fellBack) return;
  if (said.length > 8000) return;               // too big for one free-tier request

  const before = docAtCaret(t.before.lines, t.before.caret, t.before.forceAction);
  const known = before.characters();
  const cast = castFromScript(before.els);
  const recent = new Script();
  recent.els = before.els.slice(Math.max(0, before.at - 12), before.at);
  const liveText = getLines().join('\n');
  $('micState').textContent = 'Tidying up…';
  let ops;
  try {
    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...API },
      body: JSON.stringify({
        take: true, language: prefs.lang || 'en', recentScript: recent.toFountain(), mode: before.mode.mode,
        currentCharacter: before.mode.character, knownCharacters: known, narrator: meta.narrator || '',
        chunk: normalizeNames(said, known, cast),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    ops = fixNameSpelling(data.ops, known, cast).filter((o) => o.op !== 'wait' && o.op !== 'wait_scene');
  } catch (err) {
    console.warn('cleanup pass skipped', err); // the live version stays
    return;
  } finally {
    if (!recorder.active) $('micState').textContent = idleLabel();
  }
  // Only replace if nothing changed while we waited, and the AI actually wrote something.
  if (!ops.length || take || getLines().join('\n') !== liveText) return;
  if (meta.narrator) for (const op of ops) if (op.character && /^MAIN$/i.test(op.character)) op.character = meta.narrator;
  const keepMeta = { ...meta };
  voiceUndo.push(snapshot()); // ⌘Z = back to the live version
  restoreSnap(t.before);
  meta = keepMeta; // keep anything set during the take (e.g. who "main" is)
  renderTitleSheet();
  applyOps(ops, docAtCaret());
  renderMode();
  persistSoon();
  if (!meta.narrator && getLines().some((l) => /^MAIN( \(.*\))?$/.test(l))) askNarrator();
  toast('Scene tidied up · ⌘Z for the live version');
}
$('mic').onclick = toggleMic;
$('typeForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('typeBox').value.trim();
  if (!text) return;
  $('typeBox').value = '';
  const li = logItem(text);
  enqueue(() => handleText(text, li));
};
$('cursorPill').onclick = () => {
  const end = caretAtEnd();
  page.focus();
  setCaret(end.line, end.offset);
  renderMode();
};
// Clicking chrome must not steal the text cursor from the page.
document.querySelectorAll('.voice button, .top button, .status button, .menu button').forEach((b) =>
  b.addEventListener('mousedown', (e) => e.preventDefault()));

/* ───────────────────────── element switching (Tab, ⌘1–6) ───────────────────────── */
const strip = (t) => t.trim().replace(/^(\.(?!\.)|@|>\s*|!|~)/, '').replace(/^\((.*)\)$/, '$1').trim();

function setElement(type) {
  const c = getCaret();
  if (!c) return;
  page.focus();
  let i = c.line;
  const lines = getLines();
  const types = currentTypes();
  const d = page.children[i];
  const raw = d.textContent;
  const text = strip(raw);
  const prevLine = i > 0 ? lines[i - 1] : '';
  const prevType = types[i - 1];
  const needBlank = i > 0 && prevLine.trim();
  const insertBlankAbove = () => { setCaret(i, 0); exec('insertParagraph'); i++; };
  const removeBlankAbove = () => { setCaret(i, 0); exec('delete'); i--; };

  if (type === 'dialogue' || type === 'paren') {
    // needs to sit right under a character/dialogue
    if (!BLOCK.has(prevType)) {
      if (!prevLine.trim() && i > 1 && BLOCK.has(types[i - 2])) removeBlankAbove();
      else { toast('Dialogue goes under a character — press Tab on an empty line first'); return; }
    }
    if (type === 'paren') {
      replaceLine(i, `(${text})`);
      setCaret(i, text.length + 1);
    } else {
      replaceLine(i, text);
      setCaret(i, text.length);
    }
    delete page.children[i].dataset.force;
    return finishEdit();
  }
  if (type === 'action') {
    if (needBlank && BLOCK.has(prevType)) insertBlankAbove();
    const out = ALLCAPS(text) ? `!${text}` : text;
    replaceLine(i, out);
    delete page.children[i].dataset.force;
    setCaret(i, out.length);
    return finishEdit();
  }
  // scene / character / transition need a blank line above
  if (needBlank) insertBlankAbove();
  let out = text.toUpperCase();
  if (type === 'scene' && out && !SCENE_RE.test(out)) out = `.${out}`;
  if (type === 'transition' && out && !/TO:$/.test(out)) out = `> ${out}`;
  replaceLine(i, out);
  const div = page.children[i];
  if (out) delete div.dataset.force;
  else div.dataset.force = type;
  setCaret(i, out.length);
  finishEdit();
}
function finishEdit() {
  restyle();
  typedSinceVoice = true;
  afterChange();
  renderStatus();
}
function tabCycle(back = false) {
  const c = getCaret();
  if (!c) return;
  const types = currentTypes();
  const d = page.children[c.line];
  const t = d.dataset.force || types[c.line];
  const empty = !d.textContent.trim();
  const prevBlock = c.line > 0 && BLOCK.has(types[c.line - 1]);
  if (empty && prevBlock && !d.dataset.force) return setElement('paren');
  if (t === 'dialogue') return setElement('paren');
  if (t === 'paren') return setElement('dialogue');
  const ring = ['action', 'character', 'scene', 'transition'];
  const cur = ring.indexOf(t === 'blank' ? 'action' : t);
  const next = ring[(cur + (back ? ring.length - 1 : 1) + ring.length) % ring.length] || 'character';
  setElement(empty && cur <= 0 && !back ? 'character' : next);
}
$('elType').onclick = () => { page.focus(); if (!getCaret() && lastCaret) setCaret(lastCaret.line, lastCaret.offset); tabCycle(); };

/* ───────────────────────── autocomplete ───────────────────────── */
let ac = { items: [], idx: 0, apply: null };
function hideAC() { $('ac').hidden = true; ac.items = []; }
function updateAC() {
  const c = getCaret();
  const sel = getSelection();
  if (!c || !sel.isCollapsed) return hideAC();
  const d = page.children[c.line];
  const text = d.textContent;
  if (c.offset !== text.length || !text.trim()) return hideAC();
  const type = d.dataset.force || currentTypes()[c.line];
  const { types, lines } = analyse();
  let items = [];
  let apply = null;
  if (type === 'character') {
    const prefix = text.trim().replace(/^@/, '').toUpperCase();
    const names = [...new Set(lines.filter((_, i) => types[i] === 'character').map((l) => l.trim().replace(/^@/, '').replace(/\s*\(.*\)/, '').toUpperCase()))];
    items = names.filter((n) => n.startsWith(prefix) && n !== prefix);
    apply = (v) => v;
  } else if (type === 'scene') {
    const m = text.match(/^(\.|(?:INT\.?\/EXT|INT|EXT|EST|I\/E)\.?\s+)(.*)$/i);
    if (m) {
      const rest = m[2];
      if (rest.includes(' - ')) {
        const cut = rest.lastIndexOf(' - ') + 3;
        const part = rest.slice(cut).toUpperCase();
        items = TIMES.filter((t) => t.startsWith(part) && t !== part);
        apply = (v) => `${m[1].toUpperCase()}${rest.slice(0, cut).toUpperCase()}${v}`;
      } else if (rest.trim()) {
        const locs = [...new Set(lines.filter((_, i) => types[i] === 'scene').map((l) => {
          const mm = l.trim().match(/^(?:\.|(?:INT\.?\/EXT|INT|EXT|EST|I\/E)\.?\s+)(.*)$/i);
          return (mm ? mm[1] : l).split(' - ')[0].trim().toUpperCase();
        }))];
        const p = rest.toUpperCase();
        items = locs.filter((l) => l.startsWith(p) && l !== p);
        apply = (v) => `${m[1].toUpperCase()}${v}`;
      }
    }
  }
  items = items.slice(0, 6);
  if (!items.length) return hideAC();
  ac = { items, idx: 0, apply, line: c.line };
  const box = $('ac');
  box.innerHTML = items.map((it, k) => `<div class="${k === 0 ? 'on' : ''}" data-k="${k}">${esc(it)}</div>`).join('');
  const rect = sel.getRangeAt(0).getClientRects()[0] || d.getBoundingClientRect();
  box.style.left = `${Math.min(rect.left, innerWidth - 240)}px`;
  box.style.top = `${rect.bottom + 6}px`;
  box.hidden = false;
}
function acceptAC(k = ac.idx) {
  const v = ac.apply(ac.items[k]);
  replaceLine(ac.line, v);
  setCaret(ac.line, v.length);
  hideAC();
  finishEdit();
}
$('ac').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const k = e.target.closest('[data-k]')?.dataset.k;
  if (k != null) acceptAC(Number(k));
});

/* ───────────────────────── typing ───────────────────────── */
page.addEventListener('input', () => {
  normalize();
  restyle();
  typedSinceVoice = true;
  if (take) take.typed = true; // the writer edited by hand during the take: no cleanup pass
  forceAction = false;
  lastCaret = getCaret() || lastCaret;
  afterChange();
  updateAC();
  typewriter();
});
let selTimer;
document.addEventListener('selectionchange', () => {
  // Only the writer moving the cursor counts. When the page isn't focused (mic button, type box), a voice
  // insert re-renders the page and the browser reports a stale selection; taking it would send the next
  // chunk back to the old spot, so dictation would land out of order.
  if (document.activeElement !== page) return;
  const c = getCaret();
  if (!c) return;
  lastCaret = c;
  clearTimeout(selTimer);
  selTimer = setTimeout(() => { renderMode(); renderStatus(); markCurrent(); renderOutlineHere(); }, 90);
});
function renderOutlineHere() {
  const here = currentSceneLine();
  $('sceneList').querySelectorAll('li[data-i]').forEach((li) => li.classList.toggle('here', Number(li.dataset.i) === here));
}
function markCurrent() {
  if (!prefs.focus) return;
  const c = getCaret() || lastCaret;
  const divs = lineDivs();
  divs.forEach((d) => d.classList.remove('current'));
  if (!c) return page.classList.remove('has-current');
  const lines = getLines();
  let a = c.line;
  let b = c.line;
  while (a > 0 && lines[a - 1].trim()) a--;
  while (b + 1 < lines.length && lines[b + 1].trim()) b++;
  for (let i = a; i <= b; i++) divs[i].classList.add('current');
  page.classList.add('has-current');
}
function typewriter() {
  const c = getCaret();
  const d = c && page.children[c.line];
  if (!d) return;
  const r = d.getBoundingClientRect();
  if (prefs.typewriter) return desk.scrollBy({ top: r.top - desk.clientHeight * 0.45, behavior: 'smooth' });
  // never let the line you're writing slide under the voice capsule
  const limit = innerHeight - 120;
  if (r.bottom > limit) desk.scrollBy({ top: r.bottom - limit + 40, behavior: 'smooth' });
  else if (r.top < 60) desk.scrollBy({ top: r.top - 90, behavior: 'smooth' });
}

page.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (!e.metaKey && !e.ctrlKey && e.key.length === 1) document.body.classList.add('writing');

  // autocomplete navigation
  if (!$('ac').hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      ac.idx = (ac.idx + (e.key === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length;
      [...$('ac').children].forEach((el, k) => el.classList.toggle('on', k === ac.idx));
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptAC(); return; }
    if (e.key === 'Escape') { e.preventDefault(); hideAC(); return; }
  }

  const c = getCaret();
  if (!c) return;
  const sel = getSelection();

  if (e.key === 'Tab') { e.preventDefault(); hideAC(); tabCycle(e.shiftKey); return; }

  // Enter: the right element follows. Character/paren → dialogue line; action/dialogue/scene → new paragraph.
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (!sel.isCollapsed) exec('delete');
    const cc = getCaret();
    const d = page.children[cc.line];
    const types = currentTypes();
    const type = d.dataset.force || types[cc.line];
    const text = d.textContent;
    const atEnd = cc.offset === text.length;
    // make the finished line canonical (CAPS for cues, markers for forced types)
    const canonical = forcedText(text, d.dataset.force || (['character', 'scene', 'transition'].includes(type) ? type : null));
    if (canonical !== text) { replaceLine(cc.line, canonical); setCaret(cc.line, atEnd ? canonical.length : cc.offset); }
    delete page.children[cc.line].dataset.force;
    exec('insertParagraph');
    const paragraph = !e.shiftKey && atEnd && text.trim() && ['action', 'dialogue', 'scene', 'transition', 'centered', 'lyrics'].includes(type);
    if (paragraph) exec('insertParagraph');
    const now = getCaret();
    if (now) for (let i = cc.line + 1; i <= now.line; i++) delete page.children[i]?.dataset.force;
    finishEdit();
    typewriter();
    return;
  }
  if (e.key === 'Escape') hideAC();
});
page.addEventListener('blur', () => setTimeout(hideAC, 120));
page.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData.getData('text/plain') || '').replace(/\r/g, '');
  if (!text) return;
  text.split('\n').forEach((part, k) => {
    if (k) exec('insertParagraph');
    if (part) exec('insertText', part);
  });
});
page.addEventListener('copy', (e) => {
  const t = getSelection().toString();
  if (!t) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', t);
});
document.addEventListener('mousemove', (e) => {
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) document.body.classList.remove('writing');
});

function wrapSelection(mark) {
  const sel = getSelection();
  const t = sel.toString();
  exec('insertText', `${mark}${t}${mark}`);
  if (!t) {
    const c = getCaret();
    setCaret(c.line, c.offset - mark.length);
  }
}

/* ───────────────────────── find ───────────────────────── */
function openFind() {
  $('findBar').hidden = false;
  const s = getSelection().toString();
  if (s && !s.includes('\n')) $('findInput').value = s;
  $('findInput').focus();
  $('findInput').select();
  countFind();
}
function countFind() {
  const q = $('findInput').value.toLowerCase();
  if (!q) return ($('findCount').textContent = '');
  const hay = getLines().join('\n').toLowerCase();
  let n = 0;
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length)) n++;
  $('findCount').textContent = n ? `${n}` : 'none';
}
function findGo(back = false) {
  const q = $('findInput').value;
  if (!q) return;
  page.focus();
  const ok = window.find(q, false, back, true, false, false, false);
  if (!ok) toast('No matches');
  $('findInput').focus({ preventScroll: true });
}
$('findInput').addEventListener('input', countFind);
$('findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findGo(e.shiftKey); }
  if (e.key === 'Escape') { $('findBar').hidden = true; page.focus(); }
});
$('findNext').onclick = () => findGo(false);
$('findPrev').onclick = () => findGo(true);
$('findClose').onclick = () => { $('findBar').hidden = true; page.focus(); };
$('btnFind').onclick = openFind;

/* ───────────────────────── files & export ───────────────────────── */
const fileName = (ext) => `${(meta.title || 'Untitled').replace(/[^\p{L}\p{N}\- ]+/gu, '').trim() || 'Untitled'}.${ext}`;
function loadText(text) {
  voiceUndo.push(snapshot());
  typedSinceVoice = false;
  const { meta: m, body } = parseTitlePage(text);
  meta = m;
  renderTitleSheet();
  carry = '';
  lastChunk = '';
  $('whoMain').hidden = true;
  pendingScene = false;
  forceAction = false;
  lastCaret = null;
  setLines(body.replace(/\n+$/, '').split('\n'));
  desk.scrollTo({ top: 0 });
}
async function openFile() {
  if (fs) {
    const r = await fs.open();
    if (!r) return;
    filePath = r.path;
    loadText(r.text);
    toast(`Opened ${r.path.split('/').pop()}`);
  } else {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.fountain,.txt,.spmd' });
    inp.onchange = async () => { if (inp.files[0]) { filePath = null; loadText(await inp.files[0].text()); } };
    inp.click();
  }
}
async function saveFile(as = false) {
  const text = fullText();
  if (fs) {
    const p = await fs.save({ path: as ? null : filePath, text, suggestedName: fileName('fountain') });
    if (p) { filePath = p; toast('Saved'); persistSoon(); }
  } else {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: fileName('fountain') });
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
async function exportPdf() {
  hideAC();
  await document.fonts.ready;
  $('printDoc').innerHTML = renderPrint(computePages(), meta);
  try {
    if (fs?.pdf) {
      const p = await fs.pdf({ suggestedName: fileName('pdf') });
      if (p) toast('PDF exported');
    } else window.print();
  } catch (e) {
    toast(`Export failed: ${e.message}`);
  }
}
function newScript() {
  if (getLines().some((l) => l.trim()) && !confirm('Start a new screenplay? (⌘Z brings this one back)')) return;
  filePath = null;
  loadText('');
  page.focus();
}

/* ───────────────────────── menu, prefs, theme ───────────────────────── */
function applyPrefs() {
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.lang = prefs.lang || 'en'; // read by Settings (account.js)
  document.documentElement.dataset.theme = prefs.theme || (sysDark ? 'dark' : 'light');
  document.body.classList.toggle('outline-open', prefs.outline);
  document.body.classList.toggle('focus', prefs.focus);
  document.body.classList.toggle('typewriter', prefs.typewriter);
  document.body.classList.toggle('scene-nums', prefs.sceneNums);
  document.body.classList.toggle('show-breaks', prefs.breaks);
  $('btnOutline').classList.toggle('on', prefs.outline);
  $('btnFocus').classList.toggle('on', prefs.focus);
  const checks = { typewriter: prefs.typewriter, scenenums: prefs.sceneNums, pagebreaks: prefs.breaks, ai: prefs.ai && aiAvailable };
  document.querySelectorAll('.menu .check').forEach((b) => b.classList.toggle('on', Boolean(checks[b.dataset.act])));
  if (!prefs.focus) { lineDivs().forEach((d) => d.classList.remove('current')); page.classList.remove('has-current'); }
  else markCurrent();
  savePrefs();
  setTimeout(renderBreaks, 500);
}
const toggle = (k) => { prefs[k] = !prefs[k]; applyPrefs(); };
$('btnOutline').onclick = () => toggle('outline');
$('btnFocus').onclick = () => { toggle('focus'); if (prefs.focus) toast('Focus mode — ⇧⌘F to leave'); };
$('btnTheme').onclick = () => {
  const cur = document.documentElement.dataset.theme;
  prefs.theme = cur === 'dark' ? 'light' : 'dark';
  applyPrefs();
};
$('btnPdf').onclick = exportPdf;
$('btnMenu').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu-wrap')) $('menu').hidden = true; });
$('menu').onclick = (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  if (!e.target.closest('.check')) $('menu').hidden = true;
  ({
    new: newScript, open: openFile, save: () => saveFile(), saveas: () => saveFile(true),
    titlepage: openTitleDialog, pdf: exportPdf, help: () => $('help').showModal(),
    typewriter: () => toggle('typewriter'), scenenums: () => toggle('sceneNums'), pagebreaks: () => toggle('breaks'),
    ai: () => { if (!aiAvailable) return needAI('AI needs a GROQ_API_KEY'); toggle('ai'); toast(prefs.ai ? 'AI understanding on' : 'Keywords only'); },
  })[act]?.();
};

/* ───────────────────────── global shortcuts ───────────────────────── */
document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  if (!mod) {
    if (e.key === 'Alt' && !e.repeat && voiceAvailable && !recorder.active) recorder.down().catch(() => {});
    if (e.key === 'Escape' && prefs.focus && document.activeElement !== $('findInput')) { /* stay */ }
    return;
  }
  const inPage = document.activeElement === page;
  const map = {
    s: () => saveFile(e.shiftKey), o: () => openFile(), n: newScript, p: exportPdf, f: () => (e.shiftKey ? toggle('focus') : openFind()),
    '/': () => $('help').showModal(),
  };
  if (e.shiftKey) {
    if (k === 'm') return e.preventDefault(), toggleMic();
    if (k === 'o') return e.preventDefault(), toggle('outline');
    if (k === 't') return e.preventDefault(), toggle('typewriter');
    if (k === 'd') return e.preventDefault(), $('btnTheme').click();
  }
  if (map[k] && !(k === 'n' && e.shiftKey)) { e.preventDefault(); return map[k](); }
  if (inPage && /^[1-6]$/.test(e.key)) {
    e.preventDefault();
    return setElement(['scene', 'action', 'character', 'dialogue', 'paren', 'transition'][Number(e.key) - 1]);
  }
  if (inPage && !e.shiftKey && ['b', 'i', 'u'].includes(k)) {
    e.preventDefault();
    return wrapSelection({ b: '**', i: '*', u: '_' }[k]);
  }
  if (k === 'a' && (inPage || document.activeElement === document.body)) {
    e.preventDefault();
    page.focus();
    const r = document.createRange();
    r.selectNodeContents(page);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    return;
  }
  if (k === 'z' && !e.shiftKey && !typedSinceVoice && voiceUndo.length) {
    e.preventDefault();
    restoreSnap(voiceUndo.pop());
  }
});
document.addEventListener('keyup', (e) => { if (e.key === 'Alt') recorder.up(); });
window.addEventListener('blur', () => recorder.up());
window.addEventListener('resize', () => setTimeout(renderBreaks, 200));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

/* ───────────────────────── boot ───────────────────────── */
if (fs) document.body.classList.add('electron');
loadPrefs();
{
  const stored = loadStored();
  meta = { ...meta, ...(stored.meta || {}) };
  if (stored.filePath && fs) filePath = stored.filePath;
  renderTitleSheet();
  setLines((stored.text || '').split('\n'));
}
applyPrefs();
// In the Mac app, missing voice setup opens Settings (account.js); in the browser, say what to do.
function needAI(msg) {
  if (window.kalamAccount) window.dispatchEvent(new Event('kalam:need-ai'));
  else toast(msg);
}
// The mic says what pressing it will do: dictate, or set voice up first.
// …and in which language, so a wrong setting is visible at a glance ("Dictate · Hinglish").
const LANG_SHORT = { en: 'English', hinglish: 'Hinglish', hindi: 'हिन्दी', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português' };
const idleLabel = () => (voiceAvailable ? `Dictate · ${LANG_SHORT[prefs.lang] || 'English'}` : 'Set up voice');
function refreshStatus() {
  fetch('/api/status', { headers: API }).then((r) => r.json()).then((st) => {
    aiAvailable = Boolean(st.ai);
    voiceAvailable = Boolean(st.voice ?? st.ai);
    voiceRoute = st.route || (st.ai ? 'online' : null);
    if (!voiceAvailable && recorder.active) recorder.stop();
    if (!recorder.active) $('micState').textContent = idleLabel();
    applyPrefs();
  }).catch(() => {});
}
window.addEventListener('kalam:refresh', refreshStatus);
// Settings → Language
window.addEventListener('kalam:set-lang', (e) => {
  prefs.lang = e.detail;
  applyPrefs();
  if (!recorder.active) $('micState').textContent = idleLabel();
});
refreshStatus();
document.fonts?.ready.then(renderBreaks);
setTimeout(() => {
  page.focus();
  const end = caretAtEnd();
  setCaret(end.line, end.offset);
}, 50);
