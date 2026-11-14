// Industry pagination: Courier 12pt, 6 lines/inch, 54 lines per page body.
// Keeps scene headings / character cues with what follows; moves a dialogue block
// to the next page instead of orphaning its character cue. Page 1 is unnumbered.

export const CAP = 54;
const SKIP = new Set(['note', 'boneyard', 'synopsis', 'section']);
const BLOCK = new Set(['character', 'paren', 'dialogue']);

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Strip Fountain forcing markers for the printed page.
export function cleanText(text, type) {
  let t = text.trim();
  if (type === 'scene') t = t.replace(/^\.(?!\.)/, '');
  if (type === 'character') t = t.replace(/^@/, '');
  if (type === 'transition') t = t.replace(/^>\s*/, '');
  if (type === 'action') t = text.replace(/^!/, '');
  if (type === 'centered') t = t.replace(/^>\s*/, '').replace(/\s*<$/, '');
  if (type === 'lyrics') t = t.replace(/^~\s*/, '');
  t = t.replace(/\[\[.*?\]\]/g, '').replace(/\/\*.*?\*\//g, '');
  return t;
}
// **bold**  *italic*  _underline_  -> HTML (after escaping)
export function emphasis(t) {
  return esc(t)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/_(.+?)_/g, '<u>$1</u>');
}

export function buildItems(lines, types) {
  const items = [];
  lines.forEach((l, i) => {
    const t = types[i];
    if (SKIP.has(t)) return;
    if (t === 'blank' || !l.trim()) {
      if (items.length && items[items.length - 1].type !== 'blank') items.push({ type: 'blank', i, text: '', rows: 1 });
      return;
    }
    items.push({ type: t, i, text: cleanText(l, t) });
  });
  return items;
}

/** items need .rows filled in. Returns array of pages (arrays of items). */
export function paginate(items) {
  const pages = [];
  let cur = [];
  const used = () => cur.reduce((n, it) => n + it.rows, 0);
  const flush = () => {
    while (cur.length && cur[cur.length - 1].type === 'blank') cur.pop();
    if (cur.length) pages.push(cur);
    cur = [];
  };
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.type === 'pagebreak') { flush(); continue; }
    if (it.type === 'blank' && cur.length === 0) continue;
    let need = it.rows;
    const next = items[k + 1];
    const after = items[k + 2];
    if (it.type === 'scene') need += 1 + Math.min(after?.rows || 0, 2);
    if (it.type === 'character' || it.type === 'paren') need += Math.min(next?.rows || 0, 2);
    if (cur.length && used() + need > CAP) {
      const carry = [];
      if (it.type === 'dialogue' || it.type === 'paren') {
        let rows = 0;
        while (cur.length && BLOCK.has(cur[cur.length - 1].type) && rows < CAP / 2) {
          const x = cur.pop();
          rows += x.rows;
          carry.unshift(x);
        }
      }
      flush();
      cur.push(...carry);
    }
    cur.push(it);
  }
  flush();
  return pages.length ? pages : [[]];
}

/** Measure rows with a hidden 6-inch-wide Courier 12pt box. */
export function measure(items, box) {
  box.replaceChildren(...items.map((it) => {
    const d = document.createElement('div');
    d.className = 'ln';
    d.dataset.t = it.type;
    d.innerHTML = it.text ? emphasis(it.text) : '&nbsp;';
    return d;
  }));
  const kids = box.children;
  items.forEach((it, k) => { it.rows = Math.max(1, Math.round(kids[k].offsetHeight / 16)); });
  box.replaceChildren();
  return items;
}

export function renderPrint(pages, meta) {
  const html = [];
  if (meta.title) {
    html.push(`<section class="pp tp">
      <div class="tp-main"><div class="tp-title">${emphasis(meta.title)}</div><br>
      <div>${esc(meta.credit || 'Written by')}</div><br><div>${esc(meta.author || '')}</div>
      ${meta.source ? `<br><div>${esc(meta.source)}</div>` : ''}</div>
      <div class="tp-bottom"><div>${esc(meta.contact || '')}</div><div>${esc(meta.draft || '')}</div></div>
    </section>`);
  }
  pages.forEach((items, p) => {
    html.push(`<section class="pp"><div class="pnum">${p === 0 ? '' : `${p + 1}.`}</div><div class="pbody">${items
      .map((it) => `<div class="ln" data-t="${it.type}">${it.text ? emphasis(it.text) : '&nbsp;'}</div>`)
      .join('')}</div></section>`);
  });
  return html.join('');
}
