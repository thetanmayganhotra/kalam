// Settings: dictation language, voice (Groq key or offline). Electron only: talks to main.js via window.kalamAccount.
// The Groq key is sent to main once, encrypted there, and never read back into the page.
import { LANGUAGES } from './languages.js';

const acct = window.kalamAccount;
const $ = (id) => document.getElementById(id);
let st = null;

const refreshApp = () => window.dispatchEvent(new Event('kalam:refresh'));
const setMsg = (el, text, bad) => { el.textContent = text || ''; el.classList.toggle('err', Boolean(bad)); };
const MB = (n) => `${Math.round(n / 1e6)} MB`;
let tab = null; // which voice panel is showing

function renderVoice() {
  const v = st.voice;
  tab = tab || v.mode;
  document.querySelectorAll('.vseg button').forEach((b) => {
    const on = b.dataset.mode === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('panelOnline').hidden = tab !== 'online';
  $('panelOffline').hidden = tab !== 'offline';
  $('voiceUsing').innerHTML = v.route === 'online' ? 'Using now: <b>Online</b>. Groq hears you, AI shapes the script.'
    : v.route === 'offline' ? 'Using now: <b>Offline</b>, on this Mac. The keyword engine shapes the script.'
    : 'Voice is off. Set up one of these two.';

  const o = v.offline;
  $('offSize').textContent = MB(o.total || 574e6);
  const dl = o.state === 'downloading';
  $('offBar').hidden = !dl;
  if (dl) $('offFill').style.width = `${Math.round((100 * o.received) / (o.total || 1))}%`;
  $('offState').textContent = !o.installed ? 'Offline voice isn’t part of this build yet.'
    : dl ? `Downloading… ${MB(o.received)} of ${MB(o.total)}. You can keep writing.`
    : o.state === 'error' ? o.error
    : o.state === 'ready' ? 'Downloaded and ready. Works with no internet.'
    : 'Not downloaded yet.';
  $('offState').classList.toggle('err', o.state === 'error');
  $('offDownload').hidden = dl || o.state === 'ready';
  $('offDownload').disabled = !o.installed;
  $('offDownload').textContent = o.state === 'error' ? 'Try again' : `Download offline voice (${MB(o.total || 574e6)})`;
  $('offCancel').hidden = !dl;
  $('offRemove').hidden = o.state !== 'ready';
}

function render() {
  if (!st) return;
  renderVoice();
  const g = st.groq;
  $('keyState').textContent = !g.set ? 'No key yet. Voice is off until you add one.'
    : g.source === 'env' ? 'Using GROQ_API_KEY from .env (developer mode). A key saved here takes over.'
    : `Key saved (${g.hint}), encrypted on this Mac.`;
  $('keyRemove').hidden = g.source !== 'saved';
  $('keyInput').placeholder = g.source === 'saved' ? 'Paste a new key to replace it' : 'gsk_…';
  if (!st.secure) setMsg($('keyMsg'), 'Secure storage is unavailable, so the key can’t be saved.', true);
  $('langSel').value = document.documentElement.dataset.lang || 'en';
}

async function load() {
  st = await acct.status();
  render();
  return st;
}

export function openSettings() {
  setMsg($('keyMsg'), '');
  $('keyInput').value = '';
  load();
  if (!$('settingsDlg').open) $('settingsDlg').showModal();
}

async function busy(btn, fn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

if (acct) {
  $('langSel').innerHTML = Object.entries(LANGUAGES).map(([code, L]) => `<option value="${code}">${L.name}</option>`).join('');
  $('langSel').onchange = () => window.dispatchEvent(new CustomEvent('kalam:set-lang', { detail: $('langSel').value }));

  $('keyForm').onsubmit = async (e) => {
    e.preventDefault();
    const key = $('keyInput').value.trim();
    if (!key) return;
    const r = await busy($('keySave'), () => acct.setKey(key));
    if (!r.ok) return setMsg($('keyMsg'), r.error, true);
    $('keyInput').value = '';
    st = r.status;
    render();
    setMsg($('keyMsg'), r.unverified ? 'Saved. Couldn’t reach Groq to check it; it’ll be used once you’re online.' : 'Saved. Voice is ready: press ⇧⌘M and talk.');
    refreshApp();
  };
  $('keyRemove').onclick = async () => {
    st = await acct.clearKey();
    render();
    setMsg($('keyMsg'), 'Key removed from this Mac.');
    refreshApp();
  };

  document.querySelectorAll('.vseg button').forEach((b) => (b.onclick = async () => {
    tab = b.dataset.mode;
    st = await acct.setVoiceMode(tab);
    render();
    refreshApp();
  }));
  $('offDownload').onclick = async () => { st = await acct.downloadOffline(); render(); };
  $('offCancel').onclick = async () => { st = await acct.cancelOffline(); render(); };
  $('offRemove').onclick = async () => {
    if (!confirm('Remove the offline voice download (frees about 570 MB)? You can download it again any time.')) return;
    st = await acct.removeOffline();
    render();
    refreshApp();
  };
  acct.onOfflineProgress((s) => {
    const wasReady = st?.voice?.offline.state === 'ready';
    st = s;
    render();
    if (!wasReady && s.voice.offline.state === 'ready') refreshApp();
  });

  // ⋯ menu and the app menu (⌘,)
  document.querySelectorAll('[data-act="settings"]').forEach((b) => b.addEventListener('click', openSettings));
  acct.on('settings', openSettings);
  // The app wants voice/AI but it isn't set up.
  window.addEventListener('kalam:need-ai', openSettings);
  // Each time Settings opens, it shows the panel for the mode in use.
  $('settingsDlg').addEventListener('close', () => { tab = null; });

  // Only the very first launch opens Settings on its own. After that the mic says "Set up voice"
  // and pressing it opens Settings, so nobody gets nagged on every launch.
  Promise.all([load(), acct.setupSeen()]).then(([s, seen]) => {
    if (!seen && !s.voice.route) openSettings();
  });
} else {
  // Browser mode (npm run web): no settings; the key comes from .env.
  document.querySelectorAll('[data-act="settings"]').forEach((b) => (b.hidden = true));
}
