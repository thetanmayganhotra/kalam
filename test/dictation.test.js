// Realistic dictation the keyword engine must handle without the AI — Whisper-style (capitalised Roman)
// and offline-style (Hindi script romanised by lib/translit.js: all lowercase, phonetic English words).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretRules, normalizeNames, castFromScript, phoneKey } from '../public/rules.js';
import { Script } from '../public/fountain.js';
import { devanagariToRoman } from '../lib/translit.js';

function run(chunks) {
  const s = new Script();
  let carry = '';
  let pendingScene = false;
  for (const c of chunks) {
    // same steps as the app (public/app.js interpretChunk)
    const cast = castFromScript(s.els);
    const chunk = normalizeNames(`${carry} ${c}`.trim(), s.characters(), cast);
    const chars = s.els.filter((e) => e.type === 'character').map((e) => e.text);
    const lastOther = [...chars].reverse().find((n) => n !== s.mode.character) || null;
    const ops = interpretRules(chunk, { ...s.mode, knownCharacters: s.characters(), pendingScene, cast, lastOther });
    carry = '';
    pendingScene = false;
    for (const op of ops) {
      if (op.op === 'wait') carry = c;
      else if (op.op === 'wait_scene') pendingScene = true;
      else s.apply(op);
    }
  }
  return s.els.map((e) => `${e.type}:${e.text}`);
}

const CASES = [
  // scene headings, every way people say them
  [['To scene ye hai, ham playground men hain, rat ka time.'], ['scene:EXT. PLAYGROUND - NIGHT']],
  [['Scene shuru hota hai ek chhote se kamre mein. Raat ka time hai.'], ['scene:INT. CHHOTE SE KAMRE - NIGHT']],
  [['Location: Mumbai local train, subah.'], ['scene:INT. MUMBAI LOCAL TRAIN - MORNING']],
  [['Interior, police station, night.'], ['scene:INT. POLICE STATION - NIGHT']],
  [['EXT. Beach, sunset. Lehrein aati hain.'], ['scene:EXT. BEACH - SUNSET', 'action:Lehrein aati hain.']],
  [['INT. Rahul ka ghar - night'], ['scene:INT. RAHUL KA GHAR - NIGHT']],
  [['Next scene. Exterior, college canteen, day.'], ['scene:EXT. COLLEGE CANTEEN - DAY']],
  [['Flashback. Rahul ka bachpan, gaon, din.'], ['scene:EXT. RAHUL KA BACHPAN GAON - DAY (FLASHBACK)']],
  [['Fade in.', 'Hum ek purane ghar ke bahar hain, shaam ka waqt.'], ['transition:FADE IN.', 'scene:EXT. PURANE GHAR - EVENING']],
  [['Cut to.', 'Hospital ka corridor, raat.'], ['transition:CUT TO:', 'scene:INT. HOSPITAL KA CORRIDOR - NIGHT']],
  // who speaks, and how
  [['Inspector Sharma kehte hain, tumhe pata hai tum kya kar rahe ho?'], ['character:INSPECTOR SHARMA', 'dialogue:Tumhe pata hai tum kya kar rahe ho?']],
  [['Mummy awaaz lagati hai, Rahul khana kha le!'], ['character:MUMMY', 'dialogue:Rahul khana kha le!']],
  [['Rahul jawab deta hai, aa raha hoon mummy.'], ['character:RAHUL', 'dialogue:Aa raha hoon mummy.']],
  [['Priya hanste hue kehti hai, pagal hai tu.'], ['character:PRIYA', 'paren:hanste hue', 'dialogue:Pagal hai tu.']],
  [['Rahul bahut dheere se bolta hai, sorry.'], ['character:RAHUL', 'paren:bahut dheere se', 'dialogue:Sorry.']],
  [['Rahul chilla ke bolta hai, ruk!'], ['character:RAHUL', 'paren:chillate hue', 'dialogue:Ruk!']],
  [['Priya phone pe bolti hai, haan main pahunch gayi.'], ['character:PRIYA', 'paren:phone pe', 'dialogue:Haan main pahunch gayi.']],
  [['V.O. mein Rahul bolta hai, us din sab badal gaya.'], ['character:RAHUL (V.O.)', 'dialogue:Us din sab badal gaya.']],
  [['Priya ki taraf dekhkar Rahul bolta hai, chal.'], ['action:Priya ki taraf dekhkar', 'character:RAHUL', 'dialogue:Chal.']],
  [['Doctor kehta hai, sorry hum unhe bacha nahi paaye.'], ['character:DOCTOR', 'dialogue:Sorry hum unhe bacha nahi paaye.']],
  [['Rahul bolta hai', 'main nahi jaunga', 'aur Priya bolti hai', 'theek hai mat ja'],
    ['character:RAHUL', 'dialogue:Main nahi jaunga', 'character:PRIYA', 'dialogue:Theek hai mat ja']],
  // fixing
  [['Rahul bolta hai chal.', 'Rahul ka dialogue badal do: main zaroor aaunga.'], ['character:RAHUL', 'dialogue:Main zaroor aaunga.']],
  [['Rahul bolta hai chal.', 'Dialogue khatm.', 'Rahul uthta hai.'], ['character:RAHUL', 'dialogue:Chal.', 'action:Rahul uthta hai.']],
  // not cues
  [['Interior designer hai wo.'], ['action:Interior designer hai wo.']],
  [['Rahul ki taraf camera jaata hai. Woh ghabraya hua hai.'], ['action:Rahul ki taraf camera jaata hai. Woh ghabraya hua hai.']],
  // Spanish / French / German / Portuguese / English (Settings → Language)
  [['Nueva escena. Interior, cocina, noche. María dice: no puedo más.', 'Pedro responde, ¿por qué?', 'Corte a.'],
    ['scene:INT. COCINA - NIGHT', 'character:MARÍA', 'dialogue:No puedo más.', 'character:PEDRO', 'dialogue:¿Por qué?', 'transition:CUT TO:']],
  [['Estamos en la playa, atardecer. Pedro grita: ¡vuelve!'], ['scene:EXT. PLAYA - SUNSET', 'character:PEDRO', 'paren:gritando', 'dialogue:¡Vuelve!']],
  [['Nouvelle scène. Extérieur, rue de Paris, nuit. Claire dit : je pars demain.', 'Marc demande, où ça ?'],
    ['scene:EXT. RUE DE PARIS - NIGHT', 'character:CLAIRE', 'dialogue:Je pars demain.', 'character:MARC', 'dialogue:Où ça ?']],
  [['Nous sommes dans la cuisine, matin.'], ['scene:INT. CUISINE - MORNING']],
  [['Neue Szene. Innen, Küche, Abend. Anna sagt: Ich komme nicht.', 'Schnitt.'],
    ['scene:INT. KÜCHE - EVENING', 'character:ANNA', 'dialogue:Ich komme nicht.', 'transition:CUT TO:']],
  [['Nova cena. Exterior, praia, dia. João diz: vamos embora.', 'Ana pergunta, agora?'],
    ['scene:EXT. PRAIA - DAY', 'character:JOÃO', 'dialogue:Vamos embora.', 'character:ANA', 'dialogue:Agora?']],
  [['New scene. Interior, coffee shop, morning. Sarah says, I quit my job.', 'Tom asks, why?'],
    ['scene:INT. COFFEE SHOP - MORNING', 'character:SARAH', 'dialogue:I quit my job.', 'character:TOM', 'dialogue:Why?']],
  // Names said on their own switch the speaker; misheard names ("Tan mein", "Tanme") are fixed by sound.
  [[
    'Hello, hi, hum... Do log hote hain, Priyam aur Tanme, vo log ek hi flat mein saath mein rehte hain.',
    'Priyam.', 'Tan mein yaar tu aise kyon kar raha hai?',
    'Tanmay.', 'Nahin yaar, main to bas table fix kar raha hoon.',
    'Tu jhootha hai. Tan mein, nahin, kasam se.',
  ], [
    'action:Hello, hi, hum... Do log hote hain, Priyam aur Tanmay, vo log ek hi flat mein saath mein rehte hain.',
    'character:PRIYAM', 'dialogue:Tanmay yaar tu aise kyon kar raha hai?',
    'character:TANMAY', 'dialogue:Nahin yaar, main to bas table fix kar raha hoon.',
    'character:PRIYAM', 'dialogue:Tu jhootha hai.',
    'character:TANMAY', 'dialogue:Nahin, kasam se.',
  ]],
  [['Rahul bolta hai chal.', 'Priya.', 'Kahan?', 'Rahul. Ghar.'], ['character:RAHUL', 'dialogue:Chal.', 'character:PRIYA', 'dialogue:Kahan?', 'character:RAHUL', 'dialogue:Ghar.']],
  // Story told in the first person (keyword engine; the AI also writes headings/action from it)
  [[
    'Pehle main aur Tanmay flat pe the.',
    'Phir maine bola ki yaar chai peene chalte hain. Aur phir Tanmay kehta ki nahi yaar, mera mood nahi hai.',
    'Phir usne bola ki tu ja, main yahin hoon. Aur phir maine bola ki theek hai, main akela jaata hoon. Phir usne bola ki ruk, main bhi aata hoon.',
  ], [
    'action:Pehle main aur Tanmay flat pe the.',
    'character:MAIN', 'dialogue:Yaar chai peene chalte hain.',
    'character:TANMAY', 'dialogue:Nahi yaar, mera mood nahi hai. Tu ja, main yahin hoon.',
    'character:MAIN', 'dialogue:Theek hai, main akela jaata hoon.',
    'character:TANMAY', 'dialogue:Ruk, main bhi aata hoon.',
  ]],
  // a lone ordinary word is not a speaker
  [['Rahul bolta hai chal.', 'Nahin.', 'Hello.'], ['character:RAHUL', 'dialogue:Chal. Nahin. Hello.']],
  // offline transcripts: lowercase names
  [['rahul aur priya bench pe baithe hain. priya poochti hai, kal aayega?', 'rahul kahta hai, pata nahi.'],
    ['action:Rahul aur priya bench pe baithe hain.', 'character:PRIYA', 'dialogue:Kal aayega?', 'character:RAHUL', 'dialogue:Pata nahi.']],
  [['naya scene, office ke andar, dophar. sharma ji kahte hain, ye report kal tak chahiye.'],
    ['scene:INT. OFFICE - AFTERNOON', 'character:SHARMA JI', 'dialogue:Ye report kal tak chahiye.']],
];

for (const [chunks, want] of CASES) test(chunks.join(' / '), () => assert.deepEqual(run(chunks), want));

test('offline: Hindi-script transcript end to end', () => {
  const said = [
    'तो सीन ये है, हम प्लेग्राउंड में हैं, रात का टाइम।',
    'राहुल बोलता है यार मैं नहीं आऊंगा।',
    'प्रिया गुस्से से कहती है, चल ना प्लीज़।',
    'कट टू',
    'राहुल का घर, सुबह।',
    'ऐक्शन, राहुल उठता है और खिड़की खोलता है।',
  ].map(devanagariToRoman);
  assert.deepEqual(run(said), [
    'scene:EXT. PLAYGROUND - NIGHT',
    'character:RAHUL', 'dialogue:Yaar main nahi aaunga.',
    'character:PRIYA', 'paren:gusse se', 'dialogue:Chal na please.',
    'transition:CUT TO:',
    'scene:INT. RAHUL KA GHAR - MORNING',
    'action:Rahul uthta hai aur khidki kholta hai.',
  ]);
});

test('Hindi mode: cues found in Roman, script written in Devanagari (names + sluglines stay Roman)', async () => {
  const { alignHindi, opsToDevanagari } = await import('../public/hindi.js');
  const s = new Script();
  for (const c of ['नया सीन, राहुल का घर, रात।', 'राहुल गुस्से से कहता है, बाहर निकलो!', 'ऐक्शन, प्रिया दरवाज़ा खोलती है।']) {
    const a = alignHindi(c);
    for (const op of opsToDevanagari(interpretRules(a.roman, { ...s.mode, knownCharacters: s.characters() }), a.back)) s.apply(op);
  }
  assert.deepEqual(s.els.map((e) => `${e.type}:${e.text}`), [
    'scene:INT. RAHUL KA GHAR - NIGHT', 'character:RAHUL', 'paren:गुस्से से', 'dialogue:बाहर निकलो!', 'action:प्रिया दरवाज़ा खोलती है।',
  ]);
});

test('names by sound', () => {
  assert.equal(phoneKey('Tanmay'), phoneKey('Tanme'));
  assert.equal(phoneKey('Tanmay'), phoneKey('Tanmein'));
  assert.notEqual(phoneKey('Priya'), phoneKey('Priyam'));
  assert.equal(normalizeNames('Tan mein yaar, chal.', ['TANMAY']), 'Tanmay yaar, chal.');
  assert.equal(normalizeNames('Tanme, sun.', ['TANMAY']), 'Tanmay, sun.');
  assert.equal(normalizeNames('Is tan mein dard hai.', ['TANMAY']), 'Is tan mein dard hai.'); // lowercase Hindi stays
});

test('story: a known narrator replaces MAIN', () => {
  const ops = interpretRules('Phir maine bola ki chal. Aur Tanmay kehta ki ruk.', { narrator: 'PRIYAM' });
  assert.deepEqual(ops.filter((o) => o.op === 'dialogue').map((o) => o.character), ['PRIYAM', 'TANMAY']);
});

test('offline: a story told in Hindi script still gives the right dialogue (no AI)', () => {
  const said = [
    'तो हुआ ये कि पहले मैं और तन्मय अपने फ्लैट पे थे, रात के करीब ग्यारह बजे।',
    'तन्मय टेबल फिक्स कर रहा था और मैं सोफे पे लेटा हुआ था। फिर मैंने बोला कि यार ये टेबल कब से फिक्स कर रहा है तू।',
    'तो वो बोला कि बस दो मिनट और। फिर मैंने बोला कि दो मिनट तो तू एक घंटे से बोल रहा है।',
    'फिर हम दोनों छत पे गए, वहां ठंडी हवा चल रही थी। वहां उसने बोला कि यार मुझे मुंबई छोड़ना है।',
  ].map(devanagariToRoman);
  const got = run(said);
  assert.deepEqual(got.filter((l) => !l.startsWith('action:')), [
    'character:MAIN', 'dialogue:Yaar ye table kab se fix kar raha hai tu.',
    'character:TANMAY', 'dialogue:Bas do minute aur.',
    'character:MAIN', 'dialogue:Do minute to tu ek ghante se bol raha hai.',
    'character:TANMAY', 'dialogue:Yaar mujhe Mumbai chhodna hai.',
  ]);
  assert.ok(got.includes('action:Hum dono chhat pe gaye, wahan thandi hawa chal rahi thi.'));
});

test('a real story, as Tanmay told it (keyword engine, no AI)', () => {
  const said = [
    'To ek baar ki baat hai ki main aur Priyam gaye the hamare flat ke peeche ek park hai wahan pe. Priyam ko maine bola ki bhai dikho kitna badhiya flat hai, hamara yahan se dikh raha hai.',
    'to usne bola haan chal wahin sal ke cigarette peete hain. fir humne cigarette jala li. fir uske baad, Priyam ne ek aur cigarette jala li.',
    'to maine usse bola, ki bhai, Priyam, kitni cigarette bhi nahi peeni hoti. aur usne bol, Pata ke main to itni hi peeta hoon, tu bhad mein ja.',
  ];
  const s = new Script();
  for (const c of said) {
    const cast = castFromScript(s.els);
    const chars = s.els.filter((e) => e.type === 'character').map((e) => e.text);
    const lastOther = [...chars].reverse().find((n) => n !== s.mode.character) || null;
    const chunk = normalizeNames(c, s.characters(), cast);
    for (const op of interpretRules(chunk, { ...s.mode, knownCharacters: s.characters(), cast, lastOther, narrator: 'TANMAY' })) s.apply(op);
  }
  assert.deepEqual(s.els.map((e) => `${e.type}:${e.text}`), [
    'action:Ek baar ki baat hai ki main aur Priyam gaye the hamare flat ke peeche ek park hai wahan pe.',
    'character:TANMAY', 'dialogue:Bhai dikho kitna badhiya flat hai, hamara yahan se dikh raha hai.',
    'character:PRIYAM', 'dialogue:Haan chal wahin sal ke cigarette peete hain.',
    'action:Humne cigarette jala li. fir uske baad, Priyam ne ek aur cigarette jala li.',
    'character:TANMAY', 'dialogue:Bhai, Priyam, kitni cigarette bhi nahi peeni hoti.',
    'character:PRIYAM', 'dialogue:Pata ke main to itni hi peeta hoon, tu bhad mein ja.',
  ]);
});
