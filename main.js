// Electron shell: starts the local server, opens the window, handles .fountain files.
import { app, BrowserWindow, ipcMain, dialog, session, Menu, shell, clipboard } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { startServer, setVoice } from './server.js';
import * as offline from './lib/offline.js';
import { setApiKey, keySource, checkKey } from './lib/groq.js';
import * as store from './lib/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILTERS = [{ name: 'Fountain screenplay', extensions: ['fountain', 'spmd', 'txt'] }];

// Separate profile for testing (KALAM_USER_DATA=/tmp/x npm start).
if (process.env.KALAM_USER_DATA) app.setPath('userData', process.env.KALAM_USER_DATA);

// Kalam is a paid app ($5, everything included). The purchase happens in the store or on the website,
// so there's no licence check, trial or tiers in here. The writer brings their own Groq key, or uses offline voice.
const EXTERNAL = ['https://console.groq.com/'];
let win = null;

// 'online' (Groq), 'offline' (on this Mac) or null. The writer's choice wins when both are available.
function voiceRoute() {
  const online = Boolean(keySource());
  const local = offline.ready();
  const pref = store.getValue('voiceMode');
  if (pref === 'offline' && local) return 'offline';
  if (online) return 'online';
  return local ? 'offline' : null;
}

function status() {
  const key = store.getSecret('groq');
  const src = keySource();
  return {
    groq: { set: Boolean(src), source: src, hint: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '' },
    voice: {
      route: voiceRoute(),
      mode: store.getValue('voiceMode') || 'online',
      offline: { ...offline.downloadState(), installed: Boolean(offline.binaryPath()) },
    },
    secure: store.canEncrypt(),
  };
}

async function createWindow() {
  const token = crypto.randomBytes(32).toString('hex');
  const port = await startServer(0, { token });
  win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 640,
    minHeight: 480,
    title: 'Kalam',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ebe9e4',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, additionalArguments: [`--kalam-token=${token}`] },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL.some((u) => url.startsWith(u))) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

function registerAccount() {
  setApiKey(store.getSecret('groq'));
  offline.init(app.getPath('userData'));
  setVoice({ route: voiceRoute, offline: (audio, lang) => offline.transcribe(audio, lang) });
  app.on('will-quit', () => offline.stop());

  ipcMain.handle('voice:setMode', (_e, mode) => {
    store.setValue('voiceMode', mode === 'offline' ? 'offline' : 'online');
    return status();
  });
  ipcMain.handle('offline:download', () => {
    offline.download(() => win?.webContents.send('offline:progress', status()));
    return status();
  });
  ipcMain.handle('offline:cancel', () => { offline.cancelDownload(); return status(); });
  ipcMain.handle('offline:remove', async () => { await offline.removeModel(); return status(); });

  ipcMain.handle('account:status', () => status());
  // Settings opens on its own only on the very first launch. Returns whether it was already shown.
  ipcMain.handle('account:setupSeen', () => {
    const seen = Boolean(store.getValue('setupShown'));
    if (!seen) store.setValue('setupShown', true);
    return seen;
  });
  ipcMain.handle('account:setKey', async (_e, raw) => {
    const key = String(raw || '').trim();
    if (!/^gsk_[A-Za-z0-9]{20,}$/.test(key)) return { ok: false, error: 'That doesn’t look like a Groq key. It starts with gsk_.' };
    const check = await checkKey(key);
    if (!check.ok && check.reason === 'invalid') return { ok: false, error: 'Groq says this key is not valid.' };
    store.setSecret('groq', key);
    setApiKey(key);
    // Offline or Groq hiccup: save anyway, it gets used as soon as the network is back.
    return { ok: true, unverified: !check.ok, status: status() };
  });
  ipcMain.handle('account:clearKey', () => {
    store.setSecret('groq', null);
    setApiKey(null);
    return status();
  });
}

const send = (ch) => () => win?.webContents.send(ch);

// Mac App Store sandbox: a file the writer picked stays writable after a relaunch only through a
// security-scoped bookmark, which we keep per path (the last 50 files).
const MAS = process.mas === true;
function remember(file, bookmark) {
  if (!MAS || !bookmark) return;
  const marks = { ...(store.getValue('bookmarks') || {}), [file]: bookmark };
  const keys = Object.keys(marks);
  for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete marks[k];
  store.setValue('bookmarks', marks);
}
async function withAccess(file, fn) {
  const mark = MAS && (store.getValue('bookmarks') || {})[file];
  const stop = mark ? app.startAccessingSecurityScopedResource(mark) : null;
  try { return await fn(); } finally { if (typeof stop === 'function') stop(); }
}

app.whenReady().then(() => {
  // Microphone for our own local page only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const local = (details.requestingUrl || '').startsWith('http://127.0.0.1:');
    // Mic for dictation; clipboard so "Copy log" works.
    cb(local && ['media', 'microphone', 'clipboard-sanitized-write'].includes(permission));
  });

  // "Copy log": Electron's clipboard works even when the browser clipboard API refuses (focus/permission).
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
  ipcMain.handle('file:open', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILTERS, securityScopedBookmarks: MAS });
    if (r.canceled || !r.filePaths[0]) return null;
    remember(r.filePaths[0], r.bookmarks?.[0]);
    return { path: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('file:save', async (_e, { path: p, text, suggestedName }) => {
    const ask = async () => {
      const r = await dialog.showSaveDialog({ defaultPath: suggestedName || 'Untitled.fountain', filters: FILTERS, securityScopedBookmarks: MAS });
      if (r.canceled || !r.filePath) return null;
      remember(r.filePath, r.bookmark);
      return r.filePath;
    };
    const target = p || (await ask());
    if (!target) return null;
    try {
      await withAccess(target, () => fs.writeFile(target, text, 'utf8'));
      return target;
    } catch (err) {
      // Sandbox lost access to this file (e.g. no bookmark): ask where to save instead of failing.
      if (!p || !['EPERM', 'EACCES'].includes(err.code)) throw err;
      const again = await ask();
      if (!again) return null;
      await withAccess(again, () => fs.writeFile(again, text, 'utf8'));
      return again;
    }
  });

  ipcMain.handle('pdf:export', async (e, { suggestedName }) => {
    const r = await dialog.showSaveDialog({ defaultPath: suggestedName || 'Untitled.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    const data = await e.sender.printToPDF({
      pageSize: 'Letter',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
      printBackground: false,
    });
    await fs.writeFile(r.filePath, data);
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  });

  registerAccount();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('ui:settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
