// Offline cue engine: Hindi + English keywords -> the same ops the AI returns.
// Instant and free, but literal. The AI path (lib/prompt.js) handles messy speech better.

// ---------- INT / EXT ----------
const EXT_WORDS = `playground ground maidan maidaan park garden bagicha bageecha baag lawn street sadak road gali galli lane
highway expressway beach samundar samandar sea river nadi ghat ghaat jungle forest van field khet farm terrace chhat chat roof rooftop
parking market bazaar bazar mandi chowk chauraha square bus stop busstop platform station footpath pavement signal traffic crossing
courtyard aangan angan village gaon gaanv mountain pahad pahaad hill desert registan lake jheel talab pond bridge pul stadium
mela fair compound gate bahar baahar outside outdoors sky city shehar dhaba tapri ghaat pier dock harbour harbor port cemetery
kabristan shamshan graveyard campus valley lawns pitch railway track ground
calle playa parque jardín jardin bosque campo plaza mercado montaña puerto rue plage parc forêt foret champ place marché marche
montagne straße strasse strand wald feld markt platz garten berg rua praia parque floresta mercado praça`.split(/\s+/);
const INT_WORDS = `ghar house home room kamra kamre bedroom kitchen rasoi bathroom toilet washroom hall living drawing office daftar
classroom class canteen cafe cafeteria restaurant hotel bar pub hospital aspatal haspatal clinic car gaadi gadi taxi cab auto
rickshaw bus train metro plane flight lift elevator shop dukaan dukan mall theatre theater studio thana police court adalat
mandir temple church masjid gurudwara gym library lab corridor staircase seedhi sidhi basement godown warehouse factory flat apartment
cabin tent jail cell greenroom backstage club lobby reception ward icu store hostel andar inside indoors balcony verandah
dabba coach compartment
casa cocina habitación habitacion dormitorio oficina coche bar hospital tienda escuela baño
maison cuisine chambre bureau voiture école ecole magasin salon wohnung küche kueche zimmer büro buero auto schule laden
cozinha quarto escritório escritorio carro loja escola sala`.split(/\s+/);

export function classifyPlace(place) {
  const words = place.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.some((w) => ['bahar', 'baahar', 'outside', 'outdoors', 'exterior', 'ext', 'extérieur', 'exterieur', 'außen', 'aussen', 'fuera', 'fora'].includes(w))) return 'EXT.';
  if (words.some((w) => ['andar', 'inside', 'indoors', 'interior', 'int', 'intérieur', 'interieur', 'innen', 'dentro'].includes(w))) return 'INT.';
  // Hindi is head-final ("school ka playground" -> playground), so the last place-word wins.
  for (let i = words.length - 1; i >= 0; i--) {
    if (EXT_WORDS.includes(words[i])) return 'EXT.';
    if (INT_WORDS.includes(words[i])) return 'INT.';
  }
  return 'INT.';
}

const TIMES = [
  [/\b(raat|rat|night|nite|ratri)\b/i, 'NIGHT'],
  [/\b(sunset|suraj\s+dhal\s+raha)\b/i, 'SUNSET'],
  [/\b(sunrise|dawn|bhor|pau\s+phat)\b/i, 'DAWN'],
  [/\b(subah|subha|morning|savere|sawere|sawera)\b/i, 'MORNING'],
  [/\b(shaam|sham|evening)\b/i, 'EVENING'],
  [/\b(dopahar|dopehar|dophar|afternoon)\b/i, 'AFTERNOON'],
  [/\b(din|day|daytime)\b/i, 'DAY'],
  [/(?<!\p{L})(noche|nuit|nacht|noite)(?!\p{L})/iu, 'NIGHT'],
  [/(?<!\p{L})(mañana|manana|matin|morgens|manhã|manha|madrugada)(?!\p{L})/iu, 'MORNING'],
  [/(?<!\p{L})(soir|soirée|abend|anoitecer)(?!\p{L})/iu, 'EVENING'],
  [/(?<!\p{L})(atardecer|crépuscule|pôr\s+do\s+sol)(?!\p{L})/iu, 'SUNSET'],
  [/(?<!\p{L})(tarde|après-midi|nachmittag)(?!\p{L})/iu, 'AFTERNOON'],
  [/(?<!\p{L})(día|dia|jour|tag)(?!\p{L})/iu, 'DAY'],
  [/\b(continuous|lagataar|lagatar)\b/i, 'CONTINUOUS'],
  [/\b(later|thodi der baad)\b/i, 'LATER'],
];
const TIME_WORDS = /\b(raat|rat|night|nite|ratri|subah|subha|morning|savere|sawere|sawera|shaam|sham|evening|dopahar|dopehar|dophar|afternoon|din|day|daytime|continuous|lagataar|lagatar|later|sunset|sunrise|dawn|bhor)\b(\s+(ka|ki|ke)\s+(time|waqt|samay|vakt))?(\s+time)?/gi;

const FILLER = /\b(to|toh|so|ok|okay|ab|abhi|hum|ham|log|we|are|we're|were|in|at|on|the|a|an|hain|hai|he|h|ho|mein|me|men|mai|main|pe|par|location|ye|yeh|ki|that|scene|aur|and|time|wala|wali|waala|ke andar|ke bahar|andar|bahar|inside|outside|interior|exterior|int|ext|ek|ka waqt|waqt|shuru|hota|start)\b/gi;

const EU_TIME_WORDS = /(?<!\p{L})(noche|nuit|nacht|noite|mañana|manana|matin|morgens|manhã|manha|madrugada|soir|soirée|abend|anoitecer|atardecer|crépuscule|tarde|après-midi|nachmittag|día|dia|jour|tag)(?!\p{L})/giu;
const EU_FILLER = /(?<!\p{L})(interior|exterior|intérieur|extérieur|innen|außen|aussen|estamos|nous|sommes|wir|sind|nueva|escena|nouvelle|scène|neue|szene|nova|cena|ubicación)(?!\p{L})/giu;

export function buildHeading(place, suffix = '') {
  const prefix = classifyPlace(place);
  let time = '';
  for (const [re, t] of TIMES) if (re.test(place)) { time = t; break; }
  let loc = place.replace(EU_TIME_WORDS, ' ').replace(EU_FILLER, ' ').replace(TIME_WORDS, ' ').replace(FILLER, ' ');
  loc = loc.replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  loc = loc.replace(/^(?:LA|EL|LOS|LAS|LE|LES|L'|DER|DIE|DAS|DEN|DEM|OS|AS)\s+/u, '').replace(/(?:\s*-\s*)+$/, '').replace(/^(?:\s*-\s*)+/, '').replace(/\s+-\s+-\s+/g, ' - ');
  if (!loc) loc = 'UNKNOWN';
  return `${prefix} ${loc}${time ? ` - ${time}` : ''}${suffix}`;
}

// Third-person "what someone does" verbs — narration, not a spoken line.
export const NARRATION = /\b(aata|aati|aate|jaata|jaati|jata|jati|uthta|uthti|baithta|baithti|dekhta|dekhti|chalta|chalti|nikalta|nikalti|ghusta|ghusti|kholta|kholti|rakhta|rakhti|hansta|hansti|rota|roti|khada|khadi|baitha|baithi|leta|leti|walks|enters|exits|looks|sits|stands|leaves|turns)\s+(hai|hain|he)\b/i;

// ---------- cue patterns ----------
const MANNER = {
  'dheere se': 'dheere se', 'dhire se': 'dheere se', 'gusse se': 'gusse se', 'ghusse se': 'gusse se', 'pyaar se': 'pyaar se',
  'hanste hue': 'hanste hue', 'haste hue': 'hanste hue', 'rote hue': 'rote hue', 'chilla ke': 'chillate hue', 'chilla kar': 'chillate hue',
};
const VERB_PAREN = {
  chillata: 'chillate hue', chillati: 'chillate hue', chillaya: 'chillate hue', chillayi: 'chillate hue', shouts: 'shouting', yells: 'shouting',
  fusfusata: 'fusfusate hue', fusfusati: 'fusfusate hue', phusphusata: 'fusfusate hue', whispers: 'whispering',
};
Object.assign(VERB_PAREN, { grita: 'gritando', susurra: 'susurrando', crie: 'en criant', chuchote: 'en chuchotant',
  schreit: 'schreiend', ruft: 'rufend', flüstert: 'flüsternd', sussurra: 'sussurrando', screams: 'screaming', mutters: 'muttering', murmurs: 'murmuring', interrupts: 'interrupting', cries: 'crying', laughs: 'laughing',
  badbadata: 'badbadate hue', badbadati: 'badbadate hue', badbadaya: 'badbadate hue', rote: 'rote hue' });
const SPEECH_VERBS = `bolta|bolti|bolte|bola|boli|bole|bolein|kehta|kehti|kehte|kahta|kahti|kahte|kaha|kahaa|kehna|poochta|poochti|poochte|puchta|puchti|puchte|pucha|poocha|puchhta|puchhti|
chillata|chillati|chillate|chillaya|chillayi|fusfusata|fusfusati|phusphusata|badbadata|badbadati|badbadaya|
jawab\\s+deta|jawab\\s+deti|jawab\\s+dete|jawab\\s+diya|awaaz\\s+lagata|awaaz\\s+lagati|awaz\\s+lagata|awaz\\s+lagati|awaaz\\s+deta|awaaz\\s+deti|
pukarta|pukarti|pukara|samjhata|samjhati|batata|batati|daantta|daantti|daanta|tokta|tokti|
bol(?=\\s*,)|says|said|goes|asks|asked|replies|replied|shouts|yells|whispers|tells|screams|mutters|murmurs|answers|continues|adds|interrupts|exclaims|cries|laughs|
dice|dijo|pregunta|grita|responde|contesta|susurra|murmura|añade|dit|demande|crie|répond|repond|chuchote|murmure|ajoute|
sagt|fragt|ruft|schreit|antwortet|flüstert|fluestert|meint|diz|disse|sussurra|pergunta`.replace(/\s+/g, '');
// Who they said it to, between speaker and verb: "maine usse bola", "usne mujhe kaha", "Rahul ne Priya ko bola".
const OBJ = `(?:(?:usse|usko|use|unse|unko|unhe|mujhse|mujhe|mujhko|tujhse|tujhe|tujhko|isse|isko|humse|hamse|tumse|aapse|\\p{Lu}[\\p{L}'-]*\\s+(?:se|ko))\\s+)?`;
// Tone before the verb: "gusse se", "dhimi awaaz mein", "hanste hue", "naraz hokar", "phone pe".
const TONE = `(?:\\p{L}+te\\s+hue|(?:\\p{L}+\\s+){0,1}\\p{L}+\\s+(?:se|mein|me|hokar|ho\\s+ke|ke|kar)|phone\\s+(?:pe|par))`;

const NAME_STOP = new Set(`aur phir fir to toh ab then and so ki ne jo kya kaun sab koi ye yeh is us unhone usne main mai hum ham tum aap
bhi bas but par lekin ek wahi yahi agar jab tab hi na nahi kuch also just
y e et und entonces luego después puis alors ensuite dann und também también aussi auch que qui der die das el la le les`.split(/\s+/));
// Lowercase words that are NOT names (offline transcripts are all lowercase, so names can't rely on capitals).
const COMMON = new Set(`${[...NAME_STOP].join(' ')} wo woh vo voh yah vah inhone isne usse mujhse tumse unse sabse dobara phirse fir se
bahut bohot itna utna aisa waisa kaise kab kyun kyon kahan jaise sach jhooth zor zara thoda dheere jaldi seedha sidha
yahan wahan idhar udhar upar neeche andar bahar fir bhi shayad ekdum bilkul ab tak tabhi abhi the tha thi hai hain he
action scene cut dialogue bracket line wala wali log sab log koi bhi har
hello hi hey haan han ha nahin nahi na ok okay accha achha acha theek thik chalo arre are yaar yar sorry thanks thank please
shukriya wow oh ah haha hmm bye fade cut ji kaun kya kyun kaise kab kahan matlab dekho suno hamesha phir
hua huaa hui hue hota hoti hote tha thi raha rahi rahe kar karo karna karta karti karte kiya kiye
ka ko mein men pe par iska uska unka mera meri mere tera teri tere tumhara apna apni apne tujhe usko isko
kuch kya ab abhi pehle pahle baad zyada kam sirf haan ji chal chalo aaja jaa ja aa
raat rat din subah shaam waqt ghar flat kamra baat bola boli bole kaha kehta kehti dekh sun ruk ruko
ya lekin magar agar wale ek do teen dono saath kabhi pata jhooth sach mujhe humein unhe use usse
vahan wahan yahan yahaan idhar udhar upar neeche andar bahar hawa thandi table sofa sofe phone`.split(/\s+/));
const CONNECTORS = new Set(['aur', 'and', 'phir', 'fir', 'then', 'to', 'toh']);
const CUE_WORDS = new Set(['action', 'scene', 'description', 'direction', 'note', 'location', 'title', 'cut', 'dialogue', 'bracket']);
const PRONOUNS = new Set(['wo', 'woh', 'vo', 'voh', 'he', 'she', 'usne', 'unhone', 'él', 'ella', 'il', 'elle', 'er', 'sie', 'ele', 'ela']);
const ROLES = new Set(`ladka ladki aadmi admi aurat maa papa dost teacher waiter driver inspector uncle aunty bachcha baccha
dadi nani dada nana bhai didi boss doctor nurse guard chaiwala auto-wala`.split(/\s+/));

const RE = {
  // Spanish/French/German/Portuguese transitions are written in standard English form (CUT TO:, FADE OUT.)
  euTransition: /(?<!\p{L})(corte\s+a|corta\s+para|coupe\s+(?:à|a|sur)|schnitt(?:\s+zu)?|fundido\s+(?:a\s+negro|en\s+negro|de\s+salida)|fondu\s+(?:au\s+noir|enchaîné)|abblende|fade)(?!\p{L})[:.,]?/iu,
  transition: /\b(cut\s*(?:to|too|tu)|smash\s*cut(?:\s*to)?|match\s*cut(?:\s*to)?|dissolve\s*to|fade\s*to\s*black|fade\s*in|fade\s*out)\b[:.,]?/i,
  scene: [
    /\b(?:(?:to|toh|so|ok|okay|ab)\s+)?(?:scene|seen|sean|seen)\s+(?:ye|yeh|yah|yahan|aisa|is)\s+(?:hai|he|h|is)\b(?:\s+ki)?[:,.]?/i,
    /\b(?:naya|nayi|agla|agle|next|new)\s+(?:scene|seen)\b(?:\s+(?:start|shuru)(?:\s+(?:karo|kar|hota\s+hai))?)?(?:\s+(?:ye|yeh)\s+hai)?(?:\s+ki)?[:,.]?/i,
    /\b(?:scene\s+heading|slug\s*line|location\s+(?:hai|is|ye\s+hai))\b[:,.]?/i,
    /\blocation\s*:/i,
    /\b(?:scene|seen)\s+(?:shuru|start)\s+(?:hota\s+hai|karo|karte\s+hain|hai)\b[:,.]?/i,
    /(?:(?<=^)|(?<=[.?!]\s))(?=(?:interior|exterior|int|ext|intérieur|extérieur|innen|außen)(?:\.|,|\s*\/\s*ext\.?))/iu, // "Interior, police station, night"
  ],
  euScene: /(?<!\p{L})(?:(?:nueva|otra|siguiente)\s+escena|nouvelle\s+sc[eè]ne|neue\s+szene|(?:nova|próxima|proxima)\s+cena)(?!\p{L})[:,.]?/iu,
  euPlace: /(?<!\p{L})(?:estamos\s+(?:en|em|no|na)|nous\s+sommes\s+(?:à|a|dans|au|en)|wir\s+sind\s+(?:in|im|am|auf)|on\s+est\s+(?:à|dans|au))\s+([^,.?!]{2,60})[.,]?/iu,
  flashback: /\b(?:flash\s*back|flashback)(?:\s+(?:mein|me|men|shuru))?\b[:,.]?/i,
  place: [
    /\b(?:hum|ham)(?:\s+log)?\s+(?:abhi\s+)?(.{2,60}?\s+(?:ke|ki)\s+(?:bahar|baahar|andar|paas|saamne|samne|upar|bagal\s+mein))\s+(?:hain|hai|he|h)\b[.,]?/i,
    /\b(?:hum|ham)(?:\s+log)?\s+(?:abhi\s+)?(.{2,60}?)\s+(?:mein|me|men|mai|main|pe|par)\s+(?:hain|hai|he|h)\b[.,]?/i,
    /\b(?:we\s*are|we're)\s+(?:in|at|on|inside|outside)\s+([^,.?!]{2,60})[.,]?/i,
  ],
  timeTail: /^[\s,]*(?:aur\s+)?(?:(?:ye|yeh)\s+)?(?:raat|rat|subah|shaam|sham|dopahar|din|night|morning|evening|afternoon|day|noche|nuit|nacht|noite|mañana|matin|manhã|tarde|soir|abend|atardecer|día|dia|jour|tag)(?!\p{L})(?:\s+(?:ka|ki|ke)\s+(?:time|waqt|samay))?(?:\s+(?:hai|he|ho\s+rahi\s+hai|time))?[.,]?/iu,
  // No 'i' flag: a second name word must be Capitalised ("Inspector Sharma") or an honorific, so
  // "Rahul bahut dheere se bolta" doesn't become a character called RAHUL BAHUT.
  char: new RegExp(`(?:^|[\\s,.;:!?])([\\p{L}'-]+(?:\\s+(?:\\p{Lu}[\\p{L}'-]*|ji|sahab|saab|bhai|didi|uncle|aunty))?)\\s+(?:ne\\s+)?(?:(?:bhi|phir|fir)\\s+)?${OBJ}((?:${TONE})\\s+)?(${SPEECH_VERBS})\\b(?:\\s+(?:hain|hai|he|h|tha|thi|the|hoon|hu)(?!\\p{L}))?(?:\\s+(?:ki|that|ke)(?!\\p{L}))?[:,.]?`, 'u'),
  charLine: /(?:^|[\s,.])([\p{L}'-]+)\s+(?:ka|ki|ke)\s+(?:dialogue|dialog|line|lines)\b(?:\s+(?:hai|he|h))?[:,.]?/iu,
  charColon: /(?:^|[\s.])([A-Z][\p{L}'-]+)\s*:\s/u,
  action: /\b(?:action(?:\s+line)?(?:\s+(?:ye|yeh)\s+hai)?|description|direction|scene\s+mein\s+(?:dikhta|dikhaya)\s+(?:hai|jata\s+hai)(?:\s+ki)?|we\s+see)\b[:,.]?|(?<!\p{L})(?:acción|accion|aktion|ação|acao)(?!\p{L})[:,.]?/iu,
  paren: /(?:\bbracket\s+(?:mein|me|mai)\b|\bparenthetical\b|\bin\s+brackets?\b|entre\s+par[ée]nt[eè]s[ie]s|in\s+klammern|entre\s+parênteses)[:,]?\s*([^,.?!]+)[,.]?/iu,
  // "fir humne cigarette jala li", "fir uske baad, Priyam ne ek aur jala li", "phir hum chhat pe gaye"
  storyNarration: /(?<=^|[.?!]\s)(?=(?:(?:to|toh|aur)\s+)?(?:phir|fir|pehle|uske\s+baad|tab|aur\s+phir)\b[,\s]+(?![^.?!]*\b(?:bola|boli|bole|bol|kaha|kehta|kehti|poocha|pucha|says|said)\b)[^.?!]*\b(?:gaye|gayi|gaya|gae|gai|aaye|aayi|aaya|aae|pahunche|pahunchi|pahuncha|nikle|nikla|nikli|baithe|lete|the|tha|thi|li|liya|liye|lee|di|diya|diye|kiya|kiye)\b)/i,
  endDialogue: /\b(?:dialogue\s+(?:khatam|khatm|khtm|khatma|band|over|done)|end\s+(?:of\s+)?dialogue|bas\s+itna\s+hi)\b[.,]?/i,
  ext: /\b(?:v\.\s?o\.|voice[\s-]*over|o\.\s?s\.|off[\s-]*screen)(?:\s+(?:mein|me|men|se))?[\s,:.]*/i,
};

const EDIT = {
  undo: /\b(?:undo|scratch\s+that|delete\s+(?:that|it|last(?:\s+line)?)|galat\s+ho\s+gaya|galat\s+hai|mita\s+do|hata\s+do|wapas\s+lo|cancel\s+(?:that|karo))\b|(?<!\p{L})(?:borra\s+eso|deshacer|efface\s+ça|annule|lösch\s+das|rückgängig|apaga\s+isso|desfazer)(?!\p{L})/iu,
  rename: [/([\p{L}]+)\s+ka\s+naam\s+([\p{L}]+)\s+(?:kar\s+do|karo|rakho|rakh\s+do|kardo)/iu, /rename\s+([\p{L}]+)\s+(?:to|as)\s+([\p{L}]+)/iu],
  replace: /^\W*(?:nahi\W+)?(?:isko|ise|usko|change\s+(?:it|that)\s+to|make\s+it)\s*(?:aise|ye|yeh)?\s*(?:likho|kar\s+do|karo)?\s*[:,-]?\s*(.+)$/i,
  // "Rahul ka dialogue badal do: …", "last line change karo: …"
  replace2: /^\W*(?:nahi\W+)?(?:[\p{L}]+\s+(?:ka|ki)\s+)?(?:dialogue|line|last\s+line|pichli\s+line|ye\s+line|ye)\s+(?:badal\s+do|badlo|badal\s+ke|change\s+karo|change\s+kar\s+do|aise\s+likho)\s*[:,-]?\s*(.+)$/iu,
};

// Spelling-proof name key: Raahul = Rahul, Preeya = Priya, Wasim = Vasim.
export function nameKey(s) {
  return String(s).toLowerCase().replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/iya/g, 'ia')
    .replace(/(.)\1+/g, '$1').replace(/aa/g, 'a');
}
/** word -> canonical known character name (first word of multi-word names counts) */
export function matchKnown(word, known = []) {
  const k = nameKey(word);
  if (k.length < 2) return null;
  for (const n of known) {
    if (nameKey(n) === k || nameKey(n.split(/\s+/)[0]) === k) return n.toUpperCase();
  }
  // By sound: Whisper writes "Tanmay" as "Tanme" or "Tanmai". Only for longer names, to avoid false hits.
  const p = phoneKey(word);
  if (p.length >= 4) for (const n of known) if (phoneKey(n.split(/\s+/)[0]) === p) return n.toUpperCase();
  return null;
}

// Sound-alike key: all vowels (and y) count as one, a nasal ending is dropped.
// Tanmay = Tanme = Tanmai = "Tan mein" (joined) -> "tanma". Priyam -> "pram", Priya -> "pra".
export function phoneKey(s) {
  return String(s).toLowerCase().replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f').replace(/w/g, 'v').replace(/z/g, 'j').replace(/(.)\1+/g, '$1')
    .replace(/[aeiouy]+/g, 'a').replace(/an$/, 'a');
}

// Names written in the action lines ("Do log hain, Priyam aur Tanmay…"), not yet characters.
// Capitalised words mid-sentence that aren't common words.
export function castFromScript(els = []) {
  const seen = new Map();
  // Offline transcripts are lowercase: a word capitalised only because it starts a sentence still counts as a
  // name if it also shows up elsewhere in the action ("tanmay … . Tanmay table fix kar raha tha").
  const all = els.filter((e) => e.type === 'action').map((e) => e.text).join(' ').toLowerCase();
  const twice = (w) => (all.match(new RegExp(`(?<!\\p{L})${w.toLowerCase()}(?!\\p{L})`, 'gu')) || []).length >= 2;
  for (const e of els) {
    if (e.type !== 'action') continue;
    for (const sentence of e.text.split(/[.?!]+/)) {
      const first = sentence.trim().split(/[\s,;:]+/)[0]?.replace(/[^\p{L}'-]/gu, '') || '';
      const low = first.toLowerCase();
      if (first.length >= 3 && /^\p{Lu}/u.test(first) && !COMMON.has(low) && !NAME_STOP.has(low) && !CUE_WORDS.has(low) && twice(first))
        if (!seen.has(phoneKey(first))) seen.set(phoneKey(first), first);
    }
    for (const sentence of e.text.split(/[.?!]+/)) {
      const words = sentence.trim().split(/[\s,;:]+/).slice(1); // skip the sentence's first word
      for (const w of words) {
        const clean = w.replace(/[^\p{L}'-]/gu, '');
        if (clean.length < 3 || !/^\p{Lu}\p{Ll}/u.test(clean)) continue;
        const low = clean.toLowerCase();
        if (COMMON.has(low) || NAME_STOP.has(low) || CUE_WORDS.has(low)) continue;
        if (!seen.has(phoneKey(clean))) seen.set(phoneKey(clean), clean);
      }
    }
  }
  return [...seen.values()];
}

const SPLIT_TAIL = /^(mein|me|main|mai|may|mey|ne|nay)$/i;
// Fix names Whisper split or misspelled, before anything reads the transcript:
// "Tan mein yaar…" -> "Tanmay yaar…" (Tanmay is a character), "Tanme" -> "Tanmay".
// characters = script character names; cast = names seen in action (used only to re-join split names).
export function normalizeNames(text, characters = [], cast = []) {
  const chars = characters.map((c) => c.split(/\s+/)[0]);
  const canon = (key, pool) => pool.find((n) => phoneKey(n) === key);
  const title = (n) => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  const toks = text.split(/(\s+)/); // keep spaces
  for (let i = 0; i < toks.length; i += 2) {
    const w = toks[i];
    const core = w.replace(/[^\p{L}'-]/gu, '');
    // offline transcripts are lowercase: "tanmay" -> "Tanmay" once Tanmay is a character
    if (core && /^\p{Ll}/u.test(core) && core.length >= 3 && !COMMON.has(core) && !NAME_STOP.has(core)) {
      const ch = chars.find((n) => nameKey(n) === nameKey(core));
      if (ch) { toks[i] = w.replace(core, title(ch)); continue; }
    }
    if (!core || !/^\p{Lu}/u.test(core)) continue;
    const next = toks[i + 2] || '';
    const nextCore = next.replace(/[^\p{L}]/gu, '');
    // split name: "Tan mein" / "Tan may"
    if (SPLIT_TAIL.test(nextCore)) {
      const key = phoneKey(core + nextCore);
      const hit = canon(key, chars) || canon(key, cast);
      if (hit && key.length >= 4) {
        const tail = next.slice(next.indexOf(nextCore) + nextCore.length); // keep "," "." after it
        toks[i] = w.replace(core, chars.includes(hit) ? title(hit) : hit);
        toks[i + 1] = '';
        toks[i + 2] = tail;
        continue;
      }
    }
    // misspelt character name: "Tanme" -> "Tanmay"
    const key = phoneKey(core);
    const hit = key.length >= 4 && canon(key, chars);
    if (hit && nameKey(hit) !== nameKey(core)) toks[i] = w.replace(core, title(hit));
  }
  return toks.join('');
}

function resolveName(raw, ctx, before = '') {
  const toks = raw.split(/\s+/);
  const kc = ctx.knownCharacters || [];
  const known = { has: (w) => Boolean(matchKnown(w, kc)) };
  const last = toks[toks.length - 1];
  // Story told in the first person: "phir maine bola ki…" = the narrator (MAIN until the writer says who).
  if (/^(maine|mene|mainne)$/i.test(last)) return ctx.narrator || 'MAIN';
  if (PRONOUNS.has(last.toLowerCase())) {
    // "Maa chai bana rahi hai. Wo chillati hai…" -> the latest person mentioned in this chunk
    const words = before.match(/[\p{L}'-]+/gu) || [];
    const narr = (ctx.narrator || 'MAIN').toUpperCase();
    const hit = words.reverse().find((w) => w.toUpperCase() !== narr && !/^(maine|main)$/i.test(w) && !COMMON.has(w.toLowerCase()) && (known.has(w.toUpperCase()) || ROLES.has(w.toLowerCase()) || (/^\p{Lu}/u.test(w) && !NAME_STOP.has(w.toLowerCase()) && !PRONOUNS.has(w.toLowerCase()) && !CUE_WORDS.has(w.toLowerCase()))));
    if (hit) return matchKnown(hit, kc) || hit.toUpperCase();
    // A story told by "main": "usne/wo" is always the other person in the conversation.
    const pair = [ctx.character, ctx.lastOther].filter(Boolean);
    if (pair.some((n) => n.toUpperCase() === narr) || /^MAIN$/i.test(narr) && !pair.length)
      return (pair.find((n) => n.toUpperCase() !== narr) || (ctx.cast || []).find((n) => n.toUpperCase() !== narr) || '').toUpperCase() || null;
    return ctx.lastOther || ctx.character || null;
  }
  if (NAME_STOP.has(last.toLowerCase())) return null;
  const honorific = /^(ji|sahab|saab|bhai|didi|uncle|aunty)$/i.test(last);
  // Offline transcripts are all lowercase: then any word that isn't a common word can be a name.
  const isName = (t) => known.has(t.toUpperCase()) || /^\p{Lu}/u.test(t) || ROLES.has(t.toLowerCase()) ||
    (ctx.lowercase && t.length >= 3 && !COMMON.has(t.toLowerCase()) && !/(ke|kar|kr)$/i.test(t));
  if (honorific && toks.length === 2) return isName(toks[0]) ? `${matchKnown(toks[0], kc) || toks[0]} ${last}`.toUpperCase() : null;
  if (!isName(last)) return null;
  if (matchKnown(last, kc)) return matchKnown(last, kc);
  if (toks.length === 2 && !NAME_STOP.has(toks[0].toLowerCase()) && (/^\p{Lu}/u.test(toks[0]) || ROLES.has(toks[0].toLowerCase())))
    return `${toks[0]} ${last}`.toUpperCase();
  return last.toUpperCase();
}

function findCue(text, ctx) {
  const hits = [];
  const push = (type, m, extra = {}) => m && hits.push({ type, index: m.index, len: m[0].length, m, ...extra });

  push('transition', RE.transition.exec(text));
  if (!ctx.pendingScene) for (const re of [...RE.scene, RE.euScene]) push('scene', re.exec(text));
  if (ctx.mode !== 'dialogue' || ctx.pendingScene) push('place', RE.euPlace.exec(text));
  push('transition', RE.euTransition.exec(text));
  push('flashback', RE.flashback.exec(text));
  if (ctx.mode !== 'dialogue' || ctx.pendingScene) for (const re of RE.place) push('place', re.exec(text));
  push('action', RE.action.exec(text));
  push('paren', RE.paren.exec(text));
  push('endDialogue', RE.endDialogue.exec(text));
  // Story narration in the middle of a told conversation: "Phir hum dono chhat pe gaye…" -> action.
  if (ctx.mode === 'dialogue') push('action', RE.storyNarration.exec(text));

  // Character cues: scan every candidate, keep the first with a real name.
  for (const re of [RE.char, RE.charLine, RE.charColon]) {
    let offset = 0;
    while (offset < text.length) {
      const m = re.exec(text.slice(offset));
      if (!m) break;
      let name = resolveName(m[1], ctx, text.slice(0, offset + m.index));
      let skip = 0; // chars of m[0] that are content, not cue
      // "Priya aati hai aur bolti hai" -> subject sits earlier in the sentence.
      if (!name && CONNECTORS.has(m[1].split(/\s+/).pop().toLowerCase())) {
        const before = text.slice(0, offset + m.index + m[0].indexOf(m[1])).split(/[.?!]/).pop();
        const caps = before.match(/\p{Lu}[\p{L}'-]*/gu) || [];
        const cand = caps.reverse().find((t) => !NAME_STOP.has(t.toLowerCase()) && !CUE_WORDS.has(t.toLowerCase()));
        if (cand) {
          name = resolveName(cand, ctx);
          const toks = m[1].split(/\s+/);
          skip = m[0].indexOf(m[1]) + m[1].lastIndexOf(toks[toks.length - 1]);
        }
      }
      if (name && re === RE.charColon && CUE_WORDS.has(m[1].toLowerCase())) name = null;
      // "dekhkar Rahul bolta hai": only "Rahul" is the name; "dekhkar" stays in the text before it.
      const toks1 = m[1].split(/\s+/);
      if (name && !skip && toks1.length === 2 && !name.includes(toks1[0].toUpperCase()))
        skip = m[0].indexOf(m[1]) + m[1].lastIndexOf(toks1[1]);
      if (name) {
        const lead = skip || m[0].length - m[0].trimStart().length;
        hits.push({ type: 'char', index: offset + m.index + lead, len: m[0].length - lead, m, name });
        break;
      }
      offset += m.index + Math.max(1, m[0].indexOf(m[1]) + m[1].length);
    }
  }
  // Just saying an established character's name opens their dialogue:
  // "Rahul, haan samajh gaya na" -> RAHUL: "Haan samajh gaya na". Also "aur Priya, chal na".
  // Only at the chunk start or a sentence start. "Rahul uthta hai…" stays action.
  // A name said on its own ("Priyam." / "Tanmay.") is a speaker cue too, the way a screenplay reads aloud:
  // for characters, for names already in the action lines, or when the whole chunk is just a name.
  if (!ctx.pendingScene) {
    const re = /(^|[.?!]\s+)((?:(?:aur|phir|fir|and|then|ab|to|toh)\s+)?)([\p{L}'-]+)(\s*[,:!?-]\s*|\s*\.(?:\s+|$)|\s+|$)/giu;
    for (let m; (m = re.exec(text)); ) {
      const atStart = m.index === 0;
      const after = text.slice(m.index + m[0].length);
      const alone = /\./.test(m[4]) || !after.trim();
      let name = matchKnown(m[3], ctx.knownCharacters || []);
      let renameFrom = null;
      if (!name && alone) {
        const w = m[3];
        const low = w.toLowerCase();
        const nameLike = w.length >= 3 && (/^\p{Lu}/u.test(w) || ctx.lowercase) &&
          !COMMON.has(low) && !NAME_STOP.has(low) && !CUE_WORDS.has(low) && !PRONOUNS.has(low);
        const inCast = matchKnown(w, ctx.cast || []);
        // the whole chunk as spoken (not what's left after earlier cues) is just this one word
        const wholeChunk = (ctx.chunk ?? text).trim().replace(/[.,!?]+$/, '') === w;
        if (nameLike && (inCast || wholeChunk)) {
          name = w.toUpperCase();
          // the action lines spelt it differently ("Tanme"): make the script consistent
          if (inCast && nameKey(inCast) !== nameKey(w)) renameFrom = inCast;
        }
      }
      if (!name) continue;
      const sentence = after.split(/[.?!]/)[0];
      const punctuated = /[,:!?.-]/.test(m[4]);
      if (!atStart && !punctuated) continue;
      if (!punctuated && /^(ka|ki|ke|ne|ko|se|aur|and|'s)\b/i.test(after)) continue; // "Rahul ka office"
      if (NARRATION.test(sentence) && !punctuated) {
        // "Rahul uthta hai…" in the middle of someone's dialogue = action now
        if (atStart && ctx.mode === 'dialogue') hits.push({ type: 'action', index: 0, len: 0, m: [''] });
        continue;
      }
      if (!after.trim() && !atStart) continue;
      const idx = m.index + m[1].length;
      hits.push({ type: 'char', index: idx, len: m[0].length - m[1].length, m: [m[0], m[3], '', ''], name, renameFrom });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.len - a.len);
  return hits[0];
}

const stripLead = (s) => s.replace(/^[\s,.:;-]*(?:(?:ki|that|ke|to|toh|so|aur|and|phir|fir)\b[\s,:]*)*/i, '').trim();
// "…chalte hain. Aur phir" -> "…chalte hain." (all trailing connectors, not just the last one)
const stripTail = (s) => s.replace(/(?:[\s,;:-]*\b(?:aur|and|phir|fir|to|toh|so|then|uske\s+baad|wahan|yahan|tab|tabhi))*[\s,;:-]*$/i, '').trim();

/** chunk -> ops. ctx: {mode, character, knownCharacters, lastOther} */
export function interpretRules(chunk, ctx = {}) {
  const text0 = chunk.trim();
  if (!text0) return [];

  // Short chunk with an undo phrase = edit command, not content.
  if (EDIT.undo.test(text0) && text0.split(/\s+/).length <= 9) return [{ op: 'delete_last' }];
  for (const re of EDIT.rename) {
    const m = text0.match(re);
    if (m) return [{ op: 'rename', from: m[1].toUpperCase(), to: m[2].toUpperCase() }];
  }
  const rep2 = text0.match(EDIT.replace2);
  if (rep2 && rep2[1]) return [{ op: 'replace_last', text: rep2[1] }];
  const rep = text0.match(EDIT.replace);
  if (rep && rep[1]) return [{ op: 'replace_last', text: rep[1] }];

  const ops = [];
  const st = { mode: ctx.mode || 'action', character: ctx.character || null, pendingScene: Boolean(ctx.pendingScene), newPara: false, knownCharacters: ctx.knownCharacters, lastOther: ctx.lastOther, cast: ctx.cast, chunk: text0, narrator: ctx.narrator };
  // No capitals in the middle of sentences = offline transcript (Hindi script romanised): names are lowercase too.
  st.lowercase = !/[\p{Ll},]\s+\p{Lu}/u.test(text0);
  let rest = text0;
  const renames = [];
  // "V.O. mein Rahul bolta hai…" -> RAHUL (V.O.)
  let ext = '';
  const xm = rest.match(RE.ext);
  if (xm) {
    ext = /^o|off/i.test(xm[0].trim()) ? 'O.S.' : 'V.O.';
    rest = (rest.slice(0, xm.index) + ' ' + rest.slice(xm.index + xm[0].length)).trim();
  }

  const emit = (raw) => {
    let s = stripTail(stripLead(raw));
    if (!s || /^[\W_]+$/.test(s)) return;
    if (st.pendingScene) {
      // First sentence is the place; anything after it is action.
      s = s.replace(/^(int|ext|i)\.(\s*\/\s*(?:int|ext|e)\.?)?/i, '$1$2'); // "EXT. Beach" — that dot isn't a sentence end
      let [, place, after = ''] = s.match(/^([^.?!]*)[.?!]?\s*([\s\S]*)$/);
      // "…kamre mein. Raat ka time hai." -> the time sentence belongs to the heading
      const tail = after.match(RE.timeTail);
      if (tail) { place += ` ${tail[0]}`; after = after.slice(tail[0].length); }
      ops.push({ op: 'scene', heading: buildHeading(place, st.suffix) });
      st.suffix = '';
      st.pendingScene = false;
      st.mode = 'action';
      st.newPara = true;
      s = stripLead(after);
      if (!s) return;
    }
    const lastOp = ops[ops.length - 1];
    if (st.mode === 'dialogue') {
      if (lastOp?.op === 'dialogue' && !lastOp.text) lastOp.text = s;
      else ops.push({ op: 'append', text: s });
    } else if (st.newPara) {
      ops.push({ op: 'action', text: s });
      st.newPara = false;
    } else if (lastOp?.op === 'action') lastOp.text += ` ${s}`;
    else ops.push({ op: 'append', text: s });
  };

  for (let guard = 0; guard < 30; guard++) {
    const cue = findCue(rest, st);
    if (!cue) break;
    let head = rest.slice(0, cue.index);
    if (cue.type === 'char') head = head.replace(/\s*\p{L}+\s+(?:ko|se)\s*$/u, ''); // "Priyam ko [maine bola]"
    const before = stripTail(stripLead(head));
    if (cue.type === 'char' && st.mode === 'dialogue' && cue.name === st.character && st.lastOther && before) {
      // "…tu jhootha hai. Tanmay, nahin…" while Tanmay is already speaking: nobody announces the person who's
      // talking, so the words before the cue were the other person's reply.
      ops.push({ op: 'dialogue', character: st.lastOther, paren: '', text: before });
      [st.character, st.lastOther] = [st.lastOther, st.character];
    } else emit(head);
    let after = rest.slice(cue.index + cue.len);
    switch (cue.type) {
      case 'transition': {
        let t = cue.m[1].replace(/\s+/g, ' ').toUpperCase().replace(/CUT (TOO|TU)/, 'CUT TO');
        if (/^(CORTE|CORTA|COUPE|SCHNITT)/.test(t)) t = 'CUT TO';
        else if (/^(FUNDIDO|FONDU|ABBLENDE)/.test(t)) t = /ENCHAÎNÉ/.test(t) ? 'DISSOLVE TO' : 'FADE OUT';
        else if (t === 'FADE') t = 'FADE OUT';
        ops.push({ op: 'transition', text: t });
        if (/TO$/.test(t)) st.pendingScene = true;
        break;
      }
      case 'scene':
        st.pendingScene = true;
        break;
      case 'flashback':
        st.pendingScene = true;
        st.suffix = ' (FLASHBACK)';
        break;
      case 'place': {
        let place = cue.m[1];
        const tail = after.match(RE.timeTail);
        if (tail) { place += ` ${tail[0]}`; after = after.slice(tail[0].length); }
        ops.push({ op: 'scene', heading: buildHeading(place, st.suffix) });
        st.suffix = '';
        st.pendingScene = false;
        st.mode = 'action';
        st.newPara = true;
        break;
      }
      case 'char': {
        if (st.pendingScene) { ops.push({ op: 'scene', heading: buildHeading(rest.slice(0, cue.index) || 'UNKNOWN') }); st.pendingScene = false; }
        const tone = cue.m[2] ? cue.m[2].trim().toLowerCase().replace(/\s+/g, ' ') : '';
        const manner = MANNER[tone] || tone;
        const verb = (cue.m[3] || '').toLowerCase().replace(/\s+/g, ' ');
        const name = ext && !/\(/.test(cue.name) ? `${cue.name} (${ext})` : cue.name;
        ext = '';
        if (cue.renameFrom) renames.push({ op: 'rename', from: cue.renameFrom.toUpperCase(), to: name });
        if (st.character && st.character !== name) st.lastOther = st.character;
        ops.push({ op: 'dialogue', character: name, paren: manner || VERB_PAREN[verb] || '', text: '' });
        st.mode = 'dialogue';
        st.character = name;
        break;
      }
      case 'action':
        st.mode = 'action';
        st.newPara = true;
        break;
      case 'paren':
        ops.push({ op: 'paren', text: cue.m[1].trim() });
        break;
      case 'endDialogue':
        ops.push({ op: 'end_dialogue' });
        st.mode = 'action';
        st.newPara = true;
        break;
    }
    rest = after;
  }
  emit(rest);
  ops.push(...renames); // last, so the new spelling also fixes this chunk's own lines
  // "to scene ye hai" with the place still coming: ask the app to carry this speech into the next chunk.
  if (st.pendingScene && !ops.some((o) => o.op === 'transition')) return [{ op: 'wait' }];
  if (st.pendingScene) ops.push({ op: 'wait_scene' });
  return ops;
}
