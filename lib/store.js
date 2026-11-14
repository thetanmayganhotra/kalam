// Settings on disk (userData/kalam.json). Secrets are encrypted with Electron safeStorage
// (macOS Keychain-backed), so the Groq key never sits in plain text or reach the page.
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

const file = () => path.join(app.getPath('userData'), 'kalam.json');

function read() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}
function write(data) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

export const canEncrypt = () => safeStorage.isEncryptionAvailable();

export function getSecret(name) {
  const enc = read().secrets?.[name];
  if (!enc || !canEncrypt()) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
}
export function setSecret(name, value) {
  if (!canEncrypt()) throw new Error('Secure storage is unavailable on this Mac.');
  const data = read();
  data.secrets = { ...(data.secrets || {}) };
  if (value == null) delete data.secrets[name];
  else data.secrets[name] = safeStorage.encryptString(value).toString('base64');
  write(data);
}

export function getValue(name) { return read()[name]; }
export function setValue(name, value) { write({ ...read(), [name]: value }); }
