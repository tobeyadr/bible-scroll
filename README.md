# Bible Scroll

A TikTok-style way to read the Bible: swipe up for the next passage, double-tap to save one. No accounts, no database. Your place, saved passages and settings live in `localStorage` on the device.

It ships as one Cloudflare Worker with static assets. The default translation is the Berean Standard Bible (public domain), bundled in `public/bsb/`, with the King James Version in `public/kjv/`, and the World English Bible in `public/web/`, so reading needs no API key and no server call per passage. The ESV is offered through Crossway's API, with your own `ESV_API_KEY` secret (see Translations); the repository contains no ESV text.

## Run and deploy

```
npm install
npm run dev       # http://localhost:8787
npm run deploy
```

Deploying needs a Cloudflare account and `npx wrangler login`. The first deploy creates the D1 database that holds sync data (`wrangler.jsonc`, `d1_databases`; run `npx wrangler d1 create bible-scroll` if it asks for one) and the sync table appears on first use. Ask sAInt uses Workers AI, which needs no key, and the ESV needs your own `ESV_API_KEY` (see Translations). Without a key the ESV option simply reports an error; remove `'ESV'` from `ENABLED` in `public/config.js` to hide it.

Open the deployed URL on a phone and use Share, then Add to Home Screen. Books are cached after first read, so visited books work offline.

## Translations

- **BSB** (default): static files, `public/bsb/<book index>.json`. Regenerate with `node scripts/build-bsb.mjs` (downloads from bible.helloao.org; output is committed). The API drops the space where a footnote, a line break or the words of Jesus split a verse ("answered him,“Most certainly"), and the build puts it back.
- **WEB** (World English Bible, public domain): static files, `public/web/<book index>.json`, from the same API and the same conversion as the BSB. Regenerate with `node scripts/build-web.mjs`. It writes the divine name as "LORD", and the name "World English Bible" is a trademark whose owner asks that it not be used for altered text, so the text is shown unchanged apart from the layout.
- **KJV**: static files, `public/kjv/<book index>.json`, from the MIT-licensed JSON at github.com/aruljohn/Bible-kjv. Regenerate with `node scripts/build-kjv.mjs` (output is committed). The source has no paragraph or poetry marks, so each chapter is one run of verses that the app cuts into cards at verse boundaries. Public domain in the United States; in the UK the text is held by the Crown under letters patent.
- Settings shows a translation switch whenever more than one is listed in `ENABLED` (`public/config.js`). Notes and saved passages are by verse, so they follow whichever translation is showing.
- **ESV** (Crossway's API): `src/worker.js` proxies the ESV API at `/api/passage` so the key stays server-side. Set the key once with `npx wrangler secret put ESV_API_KEY` (run it yourself and paste the key at the prompt), then deploy. Passages are cached at Cloudflare's edge for an hour (the key is only used on a miss), cache misses are rate limited per IP (`SYNC_LIMITER`), and only requests from the app's own origin are accepted. The app never stores this text and the service worker skips `/api/`, so it needs a connection. It cannot be searched (the app does not hold the text), so search falls back to the BSB while ESV is showing. For local dev, copy `.dev.vars.example` to `.dev.vars`.
- **ESV(L)** (a local copy you supply, personal use only): the repository does **not** include it, because the ESV is copyrighted and Crossway has not licensed it for redistribution. `public/esv/` is git-ignored. If you have the right to keep a copy for your own use, put it there as one `<book index>.json` per book (a JSON array of chapter texts in the same shape as `public/bsb/`: `[1] verse` marks, blank lines between paragraphs, indented poetry lines), add `'ESV(L)'` to `ENABLED` in `public/config.js`, and deploy from your own machine. It works offline and can be searched, which the API route cannot. Do not publish a build that contains it.

## Notes and sync (no accounts)

Each passage has a Notes button for private thoughts. Notes, saved passages and her reading position live in `localStorage` (`public/state.js`). To use them on more than one device, Settings has **Sync across devices**:

- Turning sync on makes a random 128-bit secret and shows it as a 12-word phrase, a QR code and a link. Another device joins by typing the phrase or opening the link.
- The secret never leaves the device. From it the browser derives a record ID, a write token and an AES-GCM key (`public/keys.js`). The data is encrypted before upload, so the Worker (`src/sync.js`, D1 table `sync`) only stores ciphertext and a hash of the token.
- Devices merge per item by last edit time, with deletion markers (`public/merge.js`), so edits on two devices combine instead of overwriting. Sync runs a few seconds after a change, when the app comes back to the foreground, and when the network returns.
- There is no reset. If every device and the phrase are lost, the synced data cannot be recovered.
- Records untouched for a year are deleted by a daily cron. Requests are rate limited per IP (`SYNC_LIMITER` in `wrangler.jsonc`).

The D1 database is created automatically on first `npm run deploy`. For local dev, `wrangler dev` uses a local copy. The table is created on first use.

### Verse links in notes

A scripture reference written in a note becomes a link that opens that verse in the reading feed, for example `John 3:16`, `1 Cor 13:4-7`, `Ps 23`, `Rom 8:28`, `Jude 5`, `First John 4:8` or `Song of Solomon 2:4`. Links are made when the note is shown, so the stored note stays plain text and sync is unchanged. The finder is `public/refs.js`; it reuses the search page's reference parser, so abbreviations work the same way. A book name with no chapter number is not linked, and neither are chapters that don't exist.

## Ask sAInt

The **Ask** button on a card (and on search result cards) opens a chat about that passage. It starts with six questions to tap (how traditions read it, culture and context, historical evidence, original language, links to the rest of Scripture, living it out) and has a box for anything else. After an answer it offers the questions not yet asked. The AI is called sAInt (`NAME` in `public/ask.js`). Scripture references in an answer, such as `John 3:16` or `Acts 2:38-39`, are links that open that verse, and sAInt is told to write them that way.

- It runs on Cloudflare Workers AI: `POST /api/ask` in `src/ask.js`, through the `AI` binding in `wrangler.jsonc`. There is no key or secret to set. The Worker sends the reference, the text on screen and the chat so far to the model, and sends the answer back as plain text.
- The model is `@cf/openai/gpt-oss-120b` with low reasoning. It was the best of the ones tried (Llama 3.3 70B got Lutheran baptism wrong and made up reference fragments; Kimi K2.6 made up a detail about Nicodemus). To try another, set `ASK_MODEL` as a var, and add its reasoning setting to `MODEL_PARAMS` in `src/ask.js`: a reasoning model that thinks at length spends its whole token budget before it answers.
- Cost: Workers AI gives 10,000 Neurons a day free, and past that Workers Paid bills about $0.35 per million input tokens and $0.75 per million output tokens for this model. A typical question is a fraction of a cent. Three limits keep the bill small: 8 questions a minute per address (`ASK_LIMITER`), and **40 questions a day across all devices** (`DAILY_LIMIT` in `src/ask.js`, or set an `ASK_DAILY_LIMIT` var; 0 switches Ask off). The daily count is one row per UTC day in the D1 table `ask_usage`, taken before the model is called and given back if the model fails, and the sheet shows how many are left. Without the database the Worker refuses rather than answer uncounted. The body is also capped and a conversation is at most 12 turns.
- The prompt (`SYSTEM` in `src/ask.js`) keeps sAInt to readings that the historic traditions or mainstream scholarship hold, asks it to say so when it is not sure, and tells it to give only the answer. **After editing it, ask a real question**: gpt-oss sometimes answers with nothing but `!!!!!`, and some wordings (such as quoting example replies with apostrophes) trigger it nearly every time.
- Quirks of the model are handled in code, not trusted to the prompt. `startAnswer` waits for the first words and, if they are a run of one repeated character or take over 30 s, asks again (up to 3 tries; the question is only counted once, and given back if all fail). `answerFilter` drops any "analysis ... assistantfinal" reasoning that leaks into the answer, and non-breaking hyphens are turned into plain ones. On the page, `parseAnswer` in `public/ask.js` tidies the markdown the model writes anyway (headings, numbered lists, wrapped list items, tables) into paragraphs and lists.
- Chats live in memory for as long as the page stays open. They are not saved or synced.
- It can be wrong, and the sheet says so. For the ESV, the text on screen is sent to the model along with the question.
- To hide the button, set `SHOW_ASK` to `false` in `public/config.js`.

## Themes

Settings has Auto (follows the phone), Light, Paper and Dark. Paper is a printed-page look: cream stock with grain and aged edges, ink-black text and red verse numbers. Themes are CSS variables on `:root[data-theme="..."]` in `public/styles.css`, so adding another is one block of variables plus an entry in the settings switch.

## Search

The magnifier in the top bar (or `/` on a keyboard) opens a full-screen search page.

- Results show as a list of verses (reference plus the matching words in context). Tap a row to open the results as a feed at that verse and swipe on from there; back (the arrow or the phone's back gesture) returns to the list at the verse she got to. The button next to the count switches the whole page between the list and the feed, and remembers the choice.
- To read on from a result, tap **Read ›** on a list row or **Keep reading ›** on a feed card. That closes search and opens the verse in its chapter in the reading feed, which carries on through the rest of the chapter and then the following chapters and books.
- A feed card is one verse, with the same Save and Notes buttons as reading. The Share button is switched off for now (`SHOW_SHARE` in `public/config.js`; the code is still in `app.js`).
- With nothing typed, search shows her recent searches (the last 15, newest first). A search is kept when it found something and she opens a verse, presses Enter or leaves. Tap one to run it again, × removes it, Clear removes all. They stay on the device (`bs:searches`, erased with her other data) and are not synced. Search reads the translation she is reading (BSB, KJV, WEB or a local ESV(L), so tapping a KJV word like "believeth" finds KJV verses; the API ESV falls back to the BSB). It needs no server.

- Words: every word has to start a word in the verse (`love` also finds "loved"). Whole-word hits and words in the typed order rank first, then Bible order.
- Phrases: put them in quotes, `"born again"`.
- Passages: `john 3:16`, `john 3:16-18`, `1 cor 13`, `ps 23`, `jude 5` bring up those verses as cards in the results (a chapter shows all its verses). A "Go to" chip also opens the passage in the reading feed, and so does Enter.
- From a verse: tap a word, or long-press and drag to select a few, in the reading feed or in search results. A "Search" chip appears under the words and opens search with them (several words become a quoted phrase). Double-tap still saves the passage. The logic is in `public/pick.js`.
- The first search reads all 66 book files (about 4 MB, then cached by the service worker) and builds an in-memory verse index (`public/search.js`). Psalm title lines have no verse number, so they are not searched.

## Illustrated theme

Settings offers an **Illustrated** theme when the Worker can paint pictures: a painted picture behind the text of each card, under a dark wash so the text stays readable. Pictures are not in the repository. They are painted on demand by an image API the first time a scene is scrolled to, and kept in D1, so each is made once. The option stays hidden until a key is set (or pictures already exist).

- The plan is `art/images.json` (the style, and the 66 book pictures and 90 moments with their passages and prompts; see `art/README.md`). A book picture is the default, and a verse range, chapter or run of chapters overrides it. The narrowest match for a card's first verse wins (`public/art.js`). Spend is bounded by the plan: at most 156 pictures, plus any Redo.
- `src/art.js` is the Worker side: `GET /api/art/plan`, `GET /api/art/<id>` (paints it if missing) and `POST /api/art/<id>/regenerate`. One picture is painted at a time, a failed one waits a minute before retrying, and `ART_DAILY_LIMIT` (default 40) caps new pictures a day. Requests are also rate limited per address (`ART_LIMITER` in `wrangler.jsonc`).
- Set a key yourself, it is never in the repo: `npx wrangler secret put OPENAI_API_KEY` (or `XAI_API_KEY`). `ART_PROVIDER` (`openai` or `xai`) picks one when both are set; `ART_MODEL` and `ART_QUALITY` (OpenAI, default `medium`) are optional variables. The OpenAI request is the tested shape; the xAI one follows its published API but has not been run against the live service.
- The first view of a scene waits while it is painted (up to a minute or so, and the card keeps its plain background meanwhile). After that it is instant.
- **Redo** in the card's button column paints a new picture for that scene and replaces the current one.
- `public/artui.js` loads a picture before showing it, so a card never flashes a broken image, and fetches nothing at all in the other themes. The service worker keeps pictures in their own cache and serves them from it after the first look (`bible-scroll-art`, not cleared by app updates); a redone picture has a new `?v=` so it is fetched afresh.
- It is skipped when the browser asks to save data.

## Other notes

- Saved passages store the reference, not the text, so they follow whichever translation is active.
- The Worker only answers requests from its own origin and only for real book and chapter numbers.
- `npm test` checks the passage splitting, deep links, that all 1,189 bundled chapters of the BSB, KJV and WEB parse, and the merge, state and encryption code. Deep links look like `/#john-3-16`.
- `public/vendor/qrcode.mjs` is the MIT-licensed qrcode-generator library (Kazuhiko Arase), copied from npm.

## Licence

The code is MIT licensed (see `LICENSE`). That covers the code only, not the Bible texts, which keep their own terms: the BSB and WEB are public domain (the WEB name is a trademark, see Translations), the KJV is public domain in the United States (the Crown holds it in the UK), and the ESV is Crossway's and is only used through their API with your own key.
