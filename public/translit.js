// Offline Devanagari -> Roman Hinglish (fallback when the AI romaniser is busy).
// Not perfect (English words written in Devanagari stay phonetic), but never leaves Hindi script on the page.

const CONS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
};
const NUKTA = { 'क': 'q', 'ख': 'kh', 'ग': 'g', 'ज': 'z', 'ड': 'd', 'ढ': 'rh', 'फ': 'f', 'य': 'y' };
const MATRA = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o' };
const VOWEL = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o' };
const DIGIT = '०१२३४५६७८९';

function word(w) {
  // syllables: {c: consonant roman or '', v: vowel roman, inherent: bool}
  const syl = [];
  const ch = [...w];
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (CONS[c]) {
      let r = CONS[c];
      if (ch[i + 1] === '़') { r = NUKTA[c] || r; i++; }
      const nx = ch[i + 1];
      if (nx === '्') { syl.push({ c: r, v: '', inherent: false }); i++; }
      else if (MATRA[nx]) { syl.push({ c: r, v: MATRA[nx], inherent: false }); i++; }
      else syl.push({ c: r, v: 'a', inherent: true });
    } else if (VOWEL[c]) syl.push({ c: '', v: VOWEL[c], inherent: false });
    else if (c === 'ं' || c === 'ँ') {
      const last = syl[syl.length - 1];
      if (last) last.nasal = true;
    } else if (c === 'ः') syl.push({ c: 'h', v: '', inherent: false });
    else if (DIGIT.includes(c)) syl.push({ c: String(DIGIT.indexOf(c)), v: '', inherent: false });
    else syl.push({ c, v: '', inherent: false });
  }
  // schwa deletion: word-final, and V C(a) C V in the middle (right to left)
  const last = syl.length - 1;
  if (syl[last]?.inherent && syl.length > 1) syl[last].v = '';
  for (let i = last - 1; i > 0; i--) {
    const s = syl[i];
    if (!s.inherent || s.v === '') continue;
    const prevHasV = syl[i - 1].v !== '';
    const next = syl[i + 1];
    if (prevHasV && next && next.c && next.v !== '') s.v = '';
  }
  let out = '';
  syl.forEach((s, i) => {
    out += s.c + s.v;
    if (s.nasal) out += /^[pbm]/.test(syl[i + 1]?.c || '') ? 'm' : 'n';
  });
  return out;
}

// English words Whisper writes in Hindi script, as phonetics gives them -> how a writer types them.
// Mostly screenplay cue words (so the keyword engine recognises them) and common places.
const LOANS = Object.fromEntries(`sin:scene sina:scene sīn:scene kat:cut katt:cut aikshan:action ekshan:action ekshana:action
braiket:bracket breket:bracket phed:fade aaut:out aut:out daylog:dialogue dayalog:dialogue dailog:dialogue dayalaga:dialogue
taim:time taima:time lain:line lainen:lines last:last nekst:next nyu:new
ophis:office aphis:office plegraund:playground plegraunda:playground graund:ground grraund:ground park:park skul:school skula:school
kolej:college kaulej:college rum:room bedrum:bedroom kichan:kitchen hol:hall haspatal:hospital aspatal:hospital
stesan:station steshan:station pletaphorm:platform plaitaphorm:platform rod:road bich:beach maul:mall kaiphe:cafe kaphe:cafe
restorent:restaurant hotal:hotel hotel:hotel lipht:lift taires:terrace baalkani:balcony balkani:balcony korider:corridor
oke:okay okay:okay pliz:please plij:please sori:sorry thaink:thank yu:you hailo:hello helo:hello bai:bye
mam:ma'am sar:sir dairekt:direct karekt:correct phon:phone mobaila:mobile mobail:mobile laiphata:lift
phlait:flat phlaita:flat tebal:table tebala:table phiks:fix minat:minute minata:minute sophe:sofe sopha:sofa
mumbaee:Mumbai mumbai:Mumbai dilli:Dilli taim:time pārṭī:party parti:party pharij:fridge tivi:TV ṭīvī:TV
hua:hua huaa:hua gae:gaye gai:gayi gaee:gayi aae:aaye aai:aayi aaee:aayi kie:kiye kiya:kiya lie:liye die:diye
vahan:wahan vahaan:wahan yahaan:yahan kahaan:kahan pahle:pehle pahale:pehle donon:dono tinon:teeno
mainne:maine tumne:tumne aapne:aapne vo:wo vah:woh ham:hum hamen:humein unhen:unhe use:use
nahin:nahi yar:yaar hava:hawa karib:kareeb rat:raat sham:shaam subha:subah bat:baat`
  .split(/\s+/).filter(Boolean).map((p) => p.split(':')));

export function devanagariToRoman(text) {
  return text
    // Danda (।॥) is punctuation, not part of a word.
    .replace(/[\u0900-\u0963\u0966-\u097F]+/g, (w) => {
      const r = word(w).replace(/oong([ai])$/, 'ung$1').replace(/^aaun/, 'aaun'); // aaoonga -> aaunga
      return LOANS[r] || r;
    })
    .replace(/[।॥]/g, '.')
    .replace(/(^|[.?!]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

export const hasNonLatin = (s) => /[ऀ-ॿ؀-ۿݐ-ݿ]/.test(s);
