// Dictation languages. Used by the page (picker), server (Whisper, AI) and offline voice.
//   whisper: language code for speech-to-text   prompt: biases Whisper's spelling/style
//   ai: extra instruction for the AI interpreter (lib/prompt.js is written for Hinglish + English)
export const LANGUAGES = {
  en: {
    name: 'English',
    whisper: 'en',
    prompt: "Screenplay dictation. New scene, interior, Rahul's apartment, night. Rahul says, I'm not coming. Priya asks, why not? Cut to.",
    ai: 'The writer dictates in ENGLISH. Write all dialogue and action in English, exactly as said.',
  },
  hinglish: {
    name: 'Hinglish (Hindi + English)',
    whisper: 'hi',
    // A Hindi-script prompt keeps Whisper TRANSCRIBING. With a Roman-script prompt it sometimes translated mixed
    // Hindi-English speech into English (seen with real dictation). lib/groq.js converts the result to Roman.
    prompt: 'पटकथा का डिक्टेशन। तो सीन ये है, हम प्लेग्राउंड में हैं, रात का टाइम। राहुल बोलता है, यार मैं नहीं आऊंगा। प्रिया कहती है कि चल ना, प्लीज़। कट टू।',
    ai: '',
  },
  hindi: {
    name: 'हिन्दी (Hindi, Devanagari)',
    whisper: 'hi',
    prompt: 'पटकथा का डिक्टेशन। नया सीन, राहुल का घर, रात। राहुल बोलता है, यार मैं नहीं आऊंगा। प्रिया कहती है कि चल ना, प्लीज़। कट टू।',
    ai: 'The writer dictates in HINDI and wants the script in DEVANAGARI. This overrides the Roman-script rule above: write dialogue, action and parentheticals in Devanagari exactly as said (English words they used may stay as spoken, e.g. "सीन"). Character names in Roman CAPS (RAHUL, PRIYA) and sluglines in Roman (INT./EXT. + LOCATION in Roman caps like RAHUL KA GHAR + time in English: NIGHT) so the script opens in any screenplay app.',
  },
  es: {
    name: 'Español',
    whisper: 'es',
    prompt: 'Dictado de guion. Nueva escena, interior, cocina, noche. Rahul dice: no voy a ir. Priya pregunta: ¿por qué no? Corte a.',
    ai: 'The writer dictates in SPANISH. Cues are Spanish too (nueva escena, estamos en…, X dice / pregunta / grita / responde, corte a, acción, entre paréntesis). Keep dialogue and action in Spanish exactly as said. Sluglines: INT./EXT. + LOCATION in Spanish caps + time in English (DAY, NIGHT, MORNING…).',
  },
  fr: {
    name: 'Français',
    whisper: 'fr',
    prompt: 'Dictée de scénario. Nouvelle scène, intérieur, cuisine, nuit. Rahul dit : je ne viens pas. Priya demande : pourquoi ? Coupe à.',
    ai: 'The writer dictates in FRENCH. Cues are French too (nouvelle scène, nous sommes dans…, X dit / demande / crie / répond, coupe à, action, entre parenthèses). Keep dialogue and action in French exactly as said. Sluglines: INT./EXT. + LOCATION in French caps + time in English (DAY, NIGHT, MORNING…).',
  },
  de: {
    name: 'Deutsch',
    whisper: 'de',
    prompt: 'Drehbuch-Diktat. Neue Szene, innen, Küche, Nacht. Rahul sagt: Ich komme nicht. Priya fragt: Warum nicht? Schnitt.',
    ai: 'The writer dictates in GERMAN. Cues are German too (neue Szene, wir sind in…, X sagt / fragt / ruft / antwortet, Schnitt, Aktion, in Klammern). Keep dialogue and action in German exactly as said. Sluglines: INT./EXT. + LOCATION in German caps + time in English (DAY, NIGHT, MORNING…).',
  },
  pt: {
    name: 'Português',
    whisper: 'pt',
    prompt: 'Ditado de roteiro. Nova cena, interior, cozinha, noite. Rahul diz: eu não vou. Priya pergunta: por que não? Corta para.',
    ai: 'The writer dictates in PORTUGUESE. Cues are Portuguese too (nova cena, estamos em…, X diz / pergunta / grita / responde, corta para, ação, entre parênteses). Keep dialogue and action in Portuguese exactly as said. Sluglines: INT./EXT. + LOCATION in Portuguese caps + time in English (DAY, NIGHT, MORNING…).',
  },
};
export const lang = (code) => LANGUAGES[code] || LANGUAGES.en;
