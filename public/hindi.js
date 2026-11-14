// Hindi (Devanagari) mode without AI: the keyword engine only reads Roman, so it gets a Roman copy of the
// chunk to find the cues, and the words it writes are swapped back to the Devanagari that was actually said.
import { devanagariToRoman } from './translit.js';

const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function alignHindi(text) {
  const orig = [...text.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const roman = devanagariToRoman(text);
  const rt = (roman.match(/\S+/g) || []).map(norm);
  // devanagariToRoman maps word for word, so the two token lists line up. If not, stay in Roman.
  if (rt.length !== orig.length) return { roman, back: (s) => s };
  let cursor = 0; // ops come in reading order; search forward from the last match

  function back(str) {
    const want = (str.match(/\S+/g) || []).map(norm).filter(Boolean);
    if (!want.length) return str;
    const find = (from) => {
      for (let i = from; i + want.length <= rt.length; i++) {
        let j = 0;
        while (j < want.length && rt[i + j] === want[j]) j++;
        if (j === want.length) return i;
      }
      return -1;
    };
    let i = find(cursor);
    if (i < 0) i = find(0);
    if (i < 0) return str;
    cursor = i + want.length;
    return text.slice(orig[i].start, orig[i + want.length - 1].end).replace(/[,;:]+$/, '');
  }
  return { roman, back };
}

// Swap the written fields of keyword-engine ops back to Devanagari. Names and sluglines stay Roman caps.
export function opsToDevanagari(ops, back) {
  return ops.map((op) => {
    const o = { ...op };
    for (const k of ['text', 'paren']) if (typeof o[k] === 'string' && o[k] && op.op !== 'transition') o[k] = back(o[k]);
    return o;
  });
}
