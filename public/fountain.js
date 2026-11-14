// Script model: a flat list of Fountain elements + an insertion cursor.
// Element types: scene, action, character, paren, dialogue, transition, raw (sections/notes kept as-is).

const BLOCK = ['character', 'paren', 'dialogue'];
// Capitalise the first letter, also after ¿ ¡ « " etc.
const cap = (s) => s.replace(/^(\P{L}*)(\p{L})/u, (m, a, b) => a + b.toUpperCase());
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const baseName = (n) => n.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\^$/, '').trim();

export class Script {
  constructor() {
    this.title = '';
    this.els = [];
    this.cursor = null; // null = end of script
    this.forceAction = false;
  }

  get at() {
    return this.cursor == null ? this.els.length : Math.min(this.cursor, this.els.length);
  }
  last() {
    return this.els[this.at - 1];
  }
  insert(el) {
    this.els.splice(this.at, 0, el);
    if (this.cursor != null) this.cursor++;
    this.forceAction = false;
  }

  blockCharacter(i) {
    for (; i >= 0; i--) {
      const t = this.els[i].type;
      if (t === 'character') return baseName(this.els[i].text);
      if (!BLOCK.includes(t)) return null;
    }
    return null;
  }

  // What the next plain speech becomes.
  get mode() {
    const l = this.last();
    if (this.forceAction || !l || !BLOCK.includes(l.type)) return { mode: 'action', character: null };
    return { mode: 'dialogue', character: this.blockCharacter(this.at - 1) };
  }

  characters() {
    const seen = new Map();
    for (const e of this.els) if (e.type === 'character') {
      const n = baseName(e.text);
      seen.set(n, (seen.get(n) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }

  scenes() {
    return this.els.map((e, i) => ({ ...e, i })).filter((e) => e.type === 'scene');
  }

  snapshot() {
    return JSON.stringify({ title: this.title, els: this.els, cursor: this.cursor, forceAction: this.forceAction });
  }
  restore(s) {
    Object.assign(this, JSON.parse(s));
  }

  // ---- voice / AI operations ----
  apply(op) {
    const text = clean(op.text);
    const l = this.last();
    switch (op.op) {
      case 'scene': {
        const h = clean(op.heading || op.text).toUpperCase();
        if (h) this.insert({ type: 'scene', text: h });
        break;
      }
      case 'action':
        if (text) this.insert({ type: 'action', text: cap(text) });
        break;
      case 'dialogue': {
        const name = clean(op.character).toUpperCase();
        if (!name) return this.apply({ op: 'append', text });
        const m = this.mode;
        const sameSpeaker = m.mode === 'dialogue' && m.character === name;
        if (!sameSpeaker) this.insert({ type: 'character', text: name });
        if (clean(op.paren)) this.insert({ type: 'paren', text: clean(op.paren).replace(/^\(|\)$/g, '') });
        if (text) {
          const l2 = this.last();
          if (sameSpeaker && !clean(op.paren) && l2?.type === 'dialogue') l2.text = join(l2.text, text);
          else this.insert({ type: 'dialogue', text: cap(text) });
        }
        break;
      }
      case 'append': {
        if (!text) break;
        if (!l || l.type === 'scene' || l.type === 'transition' || l.type === 'raw') this.insert({ type: 'action', text: cap(text) });
        else if (this.forceAction && BLOCK.includes(l.type)) this.insert({ type: 'action', text: cap(text) });
        else if (l.type === 'character' || l.type === 'paren') this.insert({ type: 'dialogue', text: cap(text) });
        else if (l.type === 'action' && l.text.length > 700) this.insert({ type: 'action', text: cap(text) });
        else l.text = join(l.text, text);
        break;
      }
      case 'paren': {
        if (!text) break;
        const t = text.replace(/^\(|\)$/g, '');
        if (l?.type === 'paren') l.text = t;
        else if (l && BLOCK.includes(l.type)) this.insert({ type: 'paren', text: t });
        break;
      }
      case 'transition': {
        let t = (text || 'CUT TO:').toUpperCase();
        if (!/[:.]$/.test(t)) t += /^FADE/.test(t) ? '.' : ':';
        this.insert({ type: 'transition', text: t });
        break;
      }
      case 'delete_last': {
        if (!l) break;
        const removed = this.els.splice(this.at - 1, 1)[0];
        if (this.cursor != null) this.cursor--;
        // Removing a line removes its now-empty cue too.
        if (removed.type === 'dialogue') {
          while (this.last() && (this.last().type === 'paren' || this.last().type === 'character')) {
            const t = this.last().type;
            this.els.splice(this.at - 1, 1);
            if (this.cursor != null) this.cursor--;
            if (t === 'character') break;
          }
        }
        this.forceAction = false;
        break;
      }
      case 'replace_last':
        if (l && text) l.text = ['scene', 'transition', 'character'].includes(l.type) ? text.toUpperCase() : cap(text);
        break;
      case 'rename': {
        const from = clean(op.from).toUpperCase();
        const to = clean(op.to).toUpperCase();
        if (!from || !to) break;
        const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        for (const e of this.els) {
          if (e.type === 'character' && baseName(e.text) === from) e.text = e.text.replace(from, to);
          else if (e.type !== 'character') e.text = e.text.replace(re, (m) => (m === m.toUpperCase() ? to : cap(to.toLowerCase())));
        }
        break;
      }
      case 'end_dialogue':
        this.forceAction = true;
        break;
    }
  }

  // ---- Fountain I/O ----
  toFountain() {
    const out = [];
    if (this.title) out.push(`Title: ${this.title}`, '');
    this.els.forEach((el, i) => {
      const prev = this.els[i - 1];
      const inBlock = (el.type === 'paren' || el.type === 'dialogue') && prev && BLOCK.includes(prev.type);
      if (!inBlock && i > 0) out.push('');
      const t = el.text;
      switch (el.type) {
        case 'scene':
          out.push(/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i.test(t) ? t : `.${t}`);
          break;
        case 'character':
          out.push(/^[A-Z0-9 ._\-'()^]+$/.test(t) && /[A-Z]/.test(t) ? t : `@${t}`);
          break;
        case 'paren':
          out.push(`(${t})`);
          break;
        case 'transition':
          out.push(/^[A-Z0-9 ]+TO:$/.test(t) ? t : `> ${t}`);
          break;
        case 'action':
          // Don't let an all-caps action line get mistaken for a character/scene.
          out.push(/^[^a-z]*[A-Z][^a-z]*$/.test(t.split('\n')[0]) ? `!${t}` : t);
          break;
        default:
          out.push(t);
      }
    });
    return out.join('\n') + '\n';
  }

  static fromFountain(text, { titlePage = true } = {}) {
    const s = new Script();
    const lines = text.replace(/\r/g, '').split('\n');
    let i = 0;
    if (titlePage && /^[A-Za-z][A-Za-z ]*:/.test(lines[0] || '')) {
      for (; i < lines.length && lines[i].trim() !== ''; i++) {
        const m = lines[i].match(/^Title\s*:\s*(.*)$/i);
        if (m) s.title = m[1].trim();
      }
    }
    const paras = [];
    let cur = [];
    for (; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        if (cur.length) paras.push(cur), (cur = []);
      } else cur.push(lines[i]);
    }
    if (cur.length) paras.push(cur);

    paras.forEach((p, pi) => {
      const first = p[0].trim();
      const isLast = pi === paras.length - 1;
      if (/^(#|=|\[\[|\/\*|\*\/)/.test(first)) {
        s.els.push({ type: 'raw', text: p.join('\n') });
      } else if (/^\.(?!\.)/.test(first) || /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i.test(first)) {
        s.els.push({ type: 'scene', text: first.replace(/^\./, '') });
        if (p.length > 1) s.els.push({ type: 'action', text: p.slice(1).join('\n') });
      } else if (p.length === 1 && (/^>(?!.*<$)/.test(first) || /^[A-Z0-9 ]+TO:$/.test(first))) {
        s.els.push({ type: 'transition', text: first.replace(/^>\s*/, '') });
      } else if (
        (p.length > 1 || (isLast && first.length < 40 && /\p{Lu}/u.test(first))) &&
        !first.startsWith('!') &&
        (first.startsWith('@') || /^[^a-z]*[A-Z][^a-z]*$/.test(first.replace(/\(.*?\)/g, '')))
      ) {
        s.els.push({ type: 'character', text: first.replace(/^@/, '') });
        for (const line of p.slice(1)) {
          const t = line.trim();
          if (/^\(.*\)$/.test(t)) s.els.push({ type: 'paren', text: t.slice(1, -1) });
          else s.els.push({ type: 'dialogue', text: t });
        }
      } else {
        s.els.push({ type: 'action', text: p.join('\n').replace(/^!/, '') });
      }
    });
    return s;
  }
}

function join(a, b) {
  if (!a) return cap(b);
  const sentenceDone = /[.!?…।]$/.test(a);
  return `${a} ${sentenceDone ? cap(b) : b}`;
}
