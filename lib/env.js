// Loads Kalam/.env, then falls back to the monty-app root .env (for GROQ_API_KEY).
// Never overrides variables already set in the real environment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  if (process.env.KALAM_NO_ENV) return; // test the app the way a customer gets it: no developer key
  const files = [path.join(here, '..', '.env'), path.join(here, '..', '..', '.env')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, raw] = m;
      const val = raw.replace(/^['"]|['"]$/g, '');
      if (val && !process.env[key]) process.env[key] = val;
    }
  }
}
