import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretRules, buildHeading } from '../public/rules.js';
import { Script } from '../public/fountain.js';

// Feed chunks through rules + Script the way the app does.
function run(chunks) {
  const s = new Script();
  let carry = '';
  let pendingScene = false;
  for (const c of chunks) {
    const ctx = { ...s.mode, knownCharacters: s.characters(), pendingScene };
    const ops = interpretRules(`${carry} ${c}`.trim(), ctx);
    carry = '';
    pendingScene = false;
    for (const op of ops) {
      if (op.op === 'wait') carry = c;
      else if (op.op === 'wait_scene') pendingScene = true;
      else s.apply(op);
    }
  }
  return s;
}

test('headings: INT/EXT from place', () => {
  assert.equal(buildHeading('playground'), 'EXT. PLAYGROUND');
  assert.equal(buildHeading('Rahul ka ghar, raat ka time'), 'INT. RAHUL KA GHAR - NIGHT');
  assert.equal(buildHeading('school ka playground subah'), 'EXT. SCHOOL KA PLAYGROUND - MORNING');
  assert.equal(buildHeading('ghar ke bahar'), 'EXT. GHAR');
});

test('hum playground mein hain -> EXT scene', () => {
  const s = run(['Hum playground mein hain, raat ka time.']);
  assert.deepEqual(s.els, [{ type: 'scene', text: 'EXT. PLAYGROUND - NIGHT' }]);
});

test('to scene ye hai + place across two chunks', () => {
  const s = run(['To scene ye hai', 'Sharma ji ka ghar, kitchen, subah. Maa chai bana rahi hai.']);
  assert.equal(s.els[0].text, 'INT. SHARMA JI KA GHAR KITCHEN - MORNING');
  assert.equal(s.els[1].type, 'action');
  assert.equal(s.els[1].text, 'Maa chai bana rahi hai.');
});

test('character cue switches to dialogue, continues across chunks', () => {
  const s = run([
    'Hum park mein hain. Rahul bench pe baitha hai.',
    'Priya aati hai aur bolti hai ki tu yahan kya kar raha hai?',
    'Rahul dheere se bolta hai',
    'kuch nahi yaar',
    'bas aise hi.',
  ]);
  const types = s.els.map((e) => e.type);
  assert.deepEqual(types, ['scene', 'action', 'character', 'dialogue', 'character', 'paren', 'dialogue']);
  assert.equal(s.els[1].text, 'Rahul bench pe baitha hai. Priya aati hai');
  assert.equal(s.els[2].text, 'PRIYA');
  assert.equal(s.els[3].text, 'Tu yahan kya kar raha hai?');
  assert.equal(s.els[5].text, 'dheere se');
  assert.equal(s.els[6].text, 'Kuch nahi yaar bas aise hi.');
});

test('English cues', () => {
  const s = run(["New scene. We're at the beach, evening.", 'Action: waves crash.', 'Maya says I hate the sea.']);
  assert.equal(s.els[0].text, 'EXT. BEACH - EVENING');
  assert.equal(s.els[1].text, 'Waves crash.');
  assert.deepEqual(s.els.slice(2).map((e) => e.text), ['MAYA', 'I hate the sea.']);
});

test('cut to + undo + rename', () => {
  const s = run(['Rahul bolta hai chal', 'cut to', 'Rahul ka office', 'galat ho gaya', 'Rahul ka naam Rohit kar do']);
  assert.deepEqual(s.els.map((e) => e.text), ['ROHIT', 'Chal', 'CUT TO:']);
});

test('fountain roundtrip', () => {
  const s = run(['Hum playground mein hain, raat ka time.', 'Rahul akela hai.', 'Rahul bolta hai koi nahi aayega.', 'cut to', 'ghar ke andar']);
  s.title = 'Test';
  const f = s.toFountain();
  assert.match(f, /^Title: Test\n\nEXT\. PLAYGROUND - NIGHT\n\nRahul akela hai\.\n\nRAHUL\nKoi nahi aayega\.\n\nCUT TO:\n\nINT\. GHAR\n$/);
  assert.deepEqual(Script.fromFountain(f).els, s.els);
});

test('undo inside a sentence, pronoun -> person just mentioned', () => {
  const s = run(['Priya says chal ghar chal.', 'nahi galat ho gaya, last line hata do', 'cut to', 'Sharma ji ka ghar, kitchen, subah. Maa chai bana rahi hai. Wo chillati hai, Rahul utho!']);
  const texts = s.els.map((e) => e.text);
  assert.deepEqual(texts, ['CUT TO:', 'INT. SHARMA JI KA GHAR KITCHEN - MORNING', 'Maa chai bana rahi hai.', 'MAA', 'chillate hue', 'Rahul utho!']);
});

test('saying an established name opens their dialogue', () => {
  const s = run(['Rahul bolta hai chal.', 'Priya says nahi.', 'Rahul, haan samajh gaya na.', 'Priya', 'theek hai.', 'Rahul uthta hai aur chala jaata hai.']);
  assert.deepEqual(s.els.map((e) => `${e.type}:${e.text}`), [
    'character:RAHUL', 'dialogue:Chal.', 'character:PRIYA', 'dialogue:Nahi.',
    'character:RAHUL', 'dialogue:Haan samajh gaya na.', 'character:PRIYA', 'dialogue:Theek hai.',
    'action:Rahul uthta hai aur chala jaata hai.',
  ]);
});

test('names: spelling variants and "aur Priya," switch speaker', () => {
  const s = run(['Rahul bolta hai chal.', 'Priya says nahi.', 'Raahul, haan theek hai.', 'aur Preeya, chal phir.']);
  assert.deepEqual(s.els.map((e) => e.text), ['RAHUL', 'Chal.', 'PRIYA', 'Nahi.', 'RAHUL', 'Haan theek hai.', 'PRIYA', 'Chal phir.']);
});

