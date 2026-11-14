# Releasing Kalam

**The model:** Kalam costs **$5 once, with every feature included**. It has no trial, no tiers and no licence keys. The writer brings their own free Groq key, or uses offline voice. Either way, voice costs you nothing.

The purchase happens in the store (or on your website), so the app itself has **no payment code**. That's also the cleanest way through App Store review.

## What's in the app

| Piece | Where | State |
|---|---|---|
| Writer's own Groq key | Settings (⌘,) → Voice → *Online · Groq*. `main.js`, `lib/store.js` | Done. Three steps in the app (console.groq.com/keys → Create API Key → paste). Encrypted in the Keychain with `safeStorage`. The page only ever sees `gsk_…AbCd`. Settings opens on first run if voice isn't set up. |
| Offline voice | Settings → Voice → *Offline · this Mac*. `lib/offline.js`, `public/wav.js` | Built. The whisper.cpp engine ships inside the app; the 574 MB model is downloaded on a button press (SHA-256 checked, removable). **Needs step 0 from you.** |
| Languages | Settings → Language. `public/languages.js` | English (default), Hinglish, Español, Français, Deutsch, Português. Whisper, the AI and the keyword engine all follow the choice. |
| Keyword engine | `public/rules.js`, tests in `test/dictation.test.js` | Writes the script with no AI: offline, or when the AI is busy. Covers all six languages. |
| Mac packaging | `package.json` → `build`, `build/` | `npm run dist` = unsigned `.dmg` (for testing). `npm run dist:mas` = Mac App Store `.pkg`. `npm run dist:signed` = notarized `.dmg` for your website. |
| Local server lock | `server.js` | Only Kalam's own window can use the voice server (random token per launch). |

---

## 0. Build the offline engine once (you, ~3 min)

```bash
cd Kalam
npm run whisper
```

This clones whisper.cpp **v1.9.5** into `vendor/whisper.cpp/` (git-ignored) and builds one universal `whisper-server` (Apple Silicon + Intel, Metal) into `vendor/whisper/bin/`. It needs `cmake` (already installed) and the Xcode command line tools. The `dist` scripts run it on their own if the binary is missing.

Test it: `npm start` → Settings → *Offline · this Mac* → **Download** → dictate. The first chunk takes a few seconds while the model loads.

whisper.cpp and the Whisper model are MIT-licensed; `LICENSE-whisper.cpp.txt` ships next to the binary. Credit both on your website.

## 1. Apple Developer Program (you)

developer.apple.com/programs, US$99 a year. As an individual in India you need an Apple ID with two-factor on. Approval takes 1–2 days. Your **Team ID** (10 characters) is on developer.apple.com → Membership.

**Decide the app ID now:** `com.tanmayganhotra.kalam` (in `package.json`, `build/entitlements.mas.plist`). Changing it after launch resets everyone's settings. If you want **one $5 purchase to cover Mac and, later, iPhone**, Apple's *Universal Purchase* needs both apps under the same app record and bundle ID. So keep this ID for the iPhone app too.

## 2. Mac App Store: the main channel (you)

1. **App Store Connect → Business:** sign the **Paid Apps agreement** and add your bank and tax details (Indian bank accounts are fine). Paid apps can't go live without it.
2. **Small Business Program:** enroll (developer.apple.com/app-store/small-business-program). Apple then takes **15% instead of 30%**: on $4.99 you keep about $4.24 before tax.
3. **Certificates:** Xcode → Settings → Accounts → Manage Certificates → **+** → *Apple Distribution* and *Mac Installer Distribution*.
4. **Identifier + profile:** developer.apple.com → Identifiers → **+** → App ID `com.tanmayganhotra.kalam` (macOS). Then Profiles → **+** → *Mac App Store Connect* → that App ID → download it and save it as `Kalam/build/embedded.provisionprofile` (git-ignored).
5. **Team ID:** replace `TEAMID` in `build/entitlements.mas.plist` (the app group) and in `package.json` → `build.mas.extendInfo.ElectronTeamID`.
6. **Build:** `npm run dist:mas` → `dist/mas-universal/Kalam-<version>.pkg`. It's sandboxed: mic, network, user-chosen files only. Files stay saveable across relaunches via security-scoped bookmarks (`main.js`). The unsigned package was tested here; only signing needs your certificates.
7. **Upload** with Apple's free **Transporter** app (Mac App Store).
8. **App Store Connect → new macOS app:**
   - Price: **$4.99**. Apple sets matching prices in every country (India included), and you can adjust them per country.
   - Screenshots, a description, keywords (screenplay, script, fountain, dictation, hindi, hinglish).
   - **Privacy:** Kalam itself collects nothing. With online voice, audio and text go to Groq under the writer's own key. In the privacy questions, declare *Audio Data* → used for *App Functionality*, not linked to identity, not used for tracking.
   - Privacy policy URL and support URL (step 4).
9. **Review notes.** Reviewers must be able to use voice. Write something like this, and include a **separate Groq key just for review** (revoke it after approval):
   > Kalam turns dictation into a formatted screenplay. Voice uses the writer's own free Groq API key (Settings → Voice → Online) or an optional offline model (Settings → Voice → Offline, 574 MB download). For review, paste this key in Settings: gsk_…  Then press the mic (⇧⌘M) and say: "New scene, interior, coffee shop, morning. Sarah says, I quit my job."
10. Bump `version` in `package.json` for every upload.

## 3. Your website: optional second channel

The App Store alone is fine to start. If you also want to sell directly (you keep ~90%):

- **Lemon Squeezy** sells the `.dmg` as a **$5 digital download**: the file is delivered after payment, so no licence keys are needed. It's the merchant of record, so it handles GST/VAT worldwide and pays out to India. For Indian buyers, use a country-based discount (e.g. via ParityDeals) so the price comes to about ₹199.
- The website `.dmg` must be **Developer ID signed + notarized**, or macOS blocks it:
  1. Xcode → Manage Certificates → **+** → *Developer ID Application*.
  2. account.apple.com → App-Specific Passwords → make one.
  3. Build:
     ```bash
     export APPLE_ID="you@example.com"
     export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
     export APPLE_TEAM_ID="ABCDE12345"
     npm run dist:signed
     ```
  4. Check on a fresh Mac: `spctl -a -vvv -t install dist/Kalam-0.1.0.dmg` → `accepted, source=Notarized Developer ID`.
- A website purchase and an App Store purchase are separate. That's fine, just say so on the site.

## 4. Website (needed either way)

The App Store requires a **privacy policy URL** and a **support URL**. One page covers both: what Kalam is, a 30-second video of dictating a scene, the App Store badge, the Groq-key how-to with screenshots, a support email, and the privacy policy ("Kalam stores nothing on any server. With online voice, audio goes to Groq using your own key; offline voice never leaves your Mac."). Carrd or Framer + your own domain is enough.

## 5. Release checklist

- [ ] `npm run whisper` done; `npm test` passes
- [ ] `TEAMID` replaced; `build/embedded.provisionprofile` in place; `version` bumped
- [ ] `npm run dist:mas` → upload with Transporter → TestFlight for Mac or a review build works
- [ ] Fresh user: install → Settings opens → paste key → dictate a scene in English and in Hinglish → save `.fountain` → quit, reopen, ⌘S still saves → open in Beat
- [ ] Offline: download the model, turn off Wi-Fi, dictate
- [ ] Review notes with a review-only Groq key

---

## Later: iPhone and Android

The Electron app can't run on phones; that's a new app with a new UI. A lot carries over, because the brain is plain JavaScript with no Electron in it:

| Reusable as is | Needs a phone version |
|---|---|
| `public/rules.js` (keyword engine), `public/fountain.js` (script model + Fountain), `public/paginate.js`, `public/languages.js`, `lib/prompt.js` (AI prompt), `lib/translit.js` | UI (React Native / Expo, which this repo already uses), mic recording, the Groq key in the phone's secure storage, offline voice via whisper.cpp's mobile bindings |

Pricing on phones: a **paid app at $4.99** on the App Store and Google Play works the same way, with no IAP code. With Universal Purchase (step 1), a Mac buyer gets the iPhone app free.

## Later: hosted voice tier (no Groq key needed)

For writers who won't make a Groq key: a more expensive **subscription** where Kalam uses **your** Groq key through your own server.

```
Kalam ──(proof of subscription)──▶ your server (Cloudflare Worker) ──▶ Groq (your key)
                                     ├─ checks the subscription
                                     └─ counts minutes per user (fair-use cap)
```

- **Inside Apple's stores this must be an in-app purchase** (auto-renewable subscription). Electron has an `inAppPurchase` module for Mac App Store builds; on iPhone it's StoreKit. Your server verifies purchases with Apple's App Store Server API. On your website, it's a Lemon Squeezy subscription instead.
- The app gets a third voice option: *Kalam voice (subscription)*, next to *Own Groq key* and *Offline*. `lib/groq.js` sends requests to your server instead of to Groq.
- Groq's speech-to-text costs well under a dollar per hour of audio (check groq.com/pricing), so a small monthly price covers heavy writers.
- About 2–3 days of work. Build it when buyers ask for it.
