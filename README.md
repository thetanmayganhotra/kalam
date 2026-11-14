# Kalam (कलम)

A voice-first screenplay app. You talk and it writes the screenplay. Files save as `.fountain`, so they open straight in Beat.

## Run

```bash
cd Kalam
npm install
npm start        # Mac app (Electron)
npm run web      # same thing in a browser at http://localhost:4517
npm test         # tests for the cue engine
```

Voice needs a Groq key. In the Mac app, paste it into **Settings… (⌘,)**: it's stored encrypted in the Keychain via `safeStorage`. For development (and `npm run web`), `GROQ_API_KEY` is read from `Kalam/.env`.

**Offline voice:** run `npm run whisper` once to build the on-device engine. Then, in Settings → *Offline · this Mac*, download the model (574 MB, not bundled). Offline, the keyword engine writes the script, without AI or internet.

To build the `.dmg`, run `npm run dist` (unsigned). For the Mac App Store, signing and pricing ($5, everything included), see [RELEASE.md](RELEASE.md).

## How it works

1. **Mic.** Click the mic button or press ⌘⇧M and it keeps listening, sending each chunk when you pause. To use push-to-talk instead, hold ⌥ Option.
2. **Speech to text.** Groq Whisper (`whisper-large-v3`), nudged to write Hinglish in Roman script.
3. **Making sense of it** works in two layers:
   - `public/rules.js` is the keyword engine. It knows Hindi and English cues and works offline. It gives an instant result, and on its own a plain line ("seedha") never goes to the AI.
   - `lib/prompt.js` is the AI. A Groq LLM gets the chunks that contain a cue, Devanagari, or narration in the middle of dialogue. It decides INT/EXT, the character, the parenthetical, and so on.
4. **Script.** `public/fountain.js` keeps the elements and handles reading and writing Fountain.

## Writing (keyboard) — Beat-style

| Key | Does |
|---|---|
| `Tab` | Change element. On an empty line it makes a Character; inside dialogue it makes a (Parenthetical); on a written line it cycles Action → Character → Scene → Transition. `⇧Tab` goes the other way. |
| `↵` | The next element follows on its own: after Character/Parenthetical comes Dialogue, after Action/Dialogue/Scene a new paragraph. `⇧↵` gives a plain line break. |
| `⌘1–6` | Scene · Action · Character · Dialogue · Parenthetical · Transition |
| `⌘B` `⌘I` `⌘U` | Fountain bold / italic / underline |
| `⌘F` | Find |
| `⇧⌘O` | Outline: scenes (sections + synopses), characters by line count, pages / runtime / words |
| `⇧⌘F` `⇧⌘T` `⇧⌘D` | Focus mode · typewriter mode · light/dark |
| `⌘P` | Export a PDF in industry format (Courier 12pt, 54 lines a page, unnumbered first page, title page, scene numbers) |
| `⌘/` | Every shortcut and voice cue |

Autocomplete suggests character names on cue lines, and on scene headings it suggests locations and then times of day (DAY, NIGHT…).
Page breaks on screen come from the same paginator that lays out the PDF, so what you see is what prints. Fountain notes `[[ ]]`, boneyard `/* */`, sections `#`, synopses `=`, centered `> <` and page breaks `===` are all supported.

## What it understands

To see every cue, press **⌘/** in the app. Here are the main ones:

- **New scene:** "to scene ye hai", "naya scene", "hum playground mein hain" (it picks EXT/INT on its own), "cut to Rahul ka ghar, raat"
- **Dialogue:** "Rahul bolta hai…", "Priya kehti hai ki…", "Maya says…". Saying the name of a character who's already in the script also works: "Rahul, haan samajh gaya" goes in as Rahul's line.
- **Bracket:** "dheere se bolta hai", "chillata hai", "bracket mein …"
- **Action:** "action…", "scene mein dikhta hai ki…", or just narration ("Rahul uthta hai…")
- **Transition:** "cut to", "fade in/out", "dissolve to"
- **Fixing mistakes:** "galat ho gaya", "last line hata do", "isko aise likho: …", "Rahul ka naam Rohit kar do", and ⌘Z

To keep writing from the middle of the script, click a line's left margin. Press Esc to go back to the end.

## Limits

Groq's free tier allows 8k tokens a minute per model. That's why plain continuation lines skip the AI. If you dictate very fast, the AI is sometimes busy; the keyword engine fills in for those chunks, and the log marks them "keywords (AI busy)". Groq's Dev tier removes this limit.
