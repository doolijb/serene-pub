# BRIEF — lane `s4-seat-live`, worker w8 — docs now that card-less seats are live (+ Q9 castFromLorebook text) (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON**). Repo `/home/jody/github/serene-pub`; SDK `/home/jody/github/serene-pub-sdk`. Report in your final message (no report file). Worker w7 runs beside you (an int test) — no shared files.

## Context — what is now live (the supervisor's summary; describe it, don't extend it)

- A session can seat a **cast member with no character card** as one of its characters. It speaks as itself: its turn is its own (not the narrator's), the prompt names it and uses its member's own words (name, description, personality, greetings…), it reads **its own private lore** and nobody else's, its lines are named by it, its sprite pick uses the member's own sprite sets, and it has its own stats and sheet.
- **Seating one:** the start form's and the session settings' **Add characters** picker shows, under the cards, a second group headed by **the lorebook's name** with the line _Cast members with no character card._ — tick them like characters and press **Add**. (Not offered when starting a new world; the start form offers them once a lorebook is chosen.) The cards group is headed **Character cards** only when that second group is shown. In the session settings, a seated card-less member is listed with the cast and can be removed (it applies on **Save**). Exact UI words: **Add characters**, **Add** / _Add 3 characters_, **Character cards**, _Cast members with no character card._
- **Who acts for it:** the person who seated it (and the session's owner) may edit, retry or delete its lines — not the owner of some card, since it has none.
- **Take a seat** (a named seat, e.g. the Lair's _Take a seat_, the Dungeon Crawler's named seat): naming your character now also creates a **cast member** for them in the session's lorebook (no card), one per named seat — including a new character after a death. Renaming a seat later doesn't rename that member.
- **Private lore (owner ruling ★4, 2026-11-08):** a **background member** is one **not seated in this session** — card or not. The narrator reads the private lore of background members (and lore anchored to nobody); a seated member's private lore is theirs alone (and anyone a person plays), never the narrator's. So one member can be a speaker in one session and background in another. (`docs/lorebook-cast.md` is another lane's this wave — **don't edit it**; mention ★4 only where your pages talk about private lore.)
- **Games (`castFromLorebook`):** starting such a game with a lorebook seats that lorebook's own people, card or not.
- Owner rulings to honour in wording: "All sessions have a lorebook, [own book] or overlay." — **never write a sentence that frames a session as having no lorebook**; say the session's lorebook / its own notes. It is a **session**, never a chat.

## Goal

1. **Q9 (modder rule — exact text):**
   - `docs/plugins.md` line ~52, the sentence beginning "A game's session type can declare `castFromLorebook`…": replace its parenthesised clause so it reads: "…so that starting it with a lorebook seats that lorebook's own people, card or not, as the session's characters (only when its switch setting, if it names one, is on; never someone drawn with a persona card; for a lorebook that comes with a package, all of its people)." Keep the rest of the paragraph.
   - SDK `/home/jody/github/serene-pub-sdk/guides/frames.md` ~210–212 ("A shape that says `castFromLorebook: { field: 'examples' }` seats the attached lorebook's own people…"): same meaning — "seats the attached lorebook's own people, card or not, as the new session's characters when its `examples` switch field is on (never someone drawn with a persona card; for a lorebook that comes with a package, all of its people)."
   - SDK `/home/jody/github/serene-pub-sdk/sdk/src/descriptors.ts` ~1045–1052: the `castFromLorebook` JSDoc gains/reworded to one sentence with the same meaning. **JSDoc only — no code change. No `sdk:build`, no `sdk:test`** (a dev server runs; the supervisor reports "sdk:build owed"). Never run `npm` in the SDK root.
2. **`docs/sessions.md`:** step 5 (**Who is in it** › **Characters**, ~line 20) — one or two sentences: the picker's lorebook group and what seating a card-less member means. The composer/guest paragraph (~164, _Take a seat_) — one sentence that naming your character creates its cast member in the session's lorebook. The session settings' cast list (~376 area, the **Characters**/**Personas** cards — find the characters one) — a card-less member is listed and removable. Where the page speaks of whose lines a person may change (grep "edit", "permission", "Only the owner") — the seater rule, if such a passage exists.
3. **`docs/group-sessions.md`:** a short paragraph (or a sentence in **The basics** / **Who is due next**) — a seated card-less member takes turns like any character: Continue, Pick who speaks and the turn order name it; its reply is its own.
4. **`docs/personas.md`:** where a seat with a name but no card is described (grep "seat", "Take a seat"; if none, in **Use it in a session**) — one sentence: naming your character with **Take a seat** creates a cast member for them in the session's lorebook.
5. Then grep the four app docs for any sentence the new behaviour makes false (e.g. "only characters with a card", "a seat with no card has no …", a narrator/background-lore rule) and fix it in the same register; list each.

## Writing rules (STYLE-GUIDE §10, quoted)

- "Sentence case everywhere." · "A button says what happens." · "One name per thing, across the whole flow: the thing you open is a session, never a chat." · "Labels are nouns, hints are sentences … errors say what went wrong and what to do." · "No filler." · "Help is one sentence."
- UI words in **bold** exactly as the UI shows them; quoted UI sentences in _italics_ — match the surrounding docs.
- Match each page's existing register and paragraph length; add, don't restructure. No new headings unless a page has no place for the paragraph (then one `###`, and say why).
- No code identifiers in app docs (`docs/*.md`) except where the page already uses them (plugins.md does).

## Files owned (edit only these)

`docs/sessions.md`, `docs/group-sessions.md`, `docs/personas.md`, `docs/plugins.md`, `/home/jody/github/serene-pub-sdk/guides/frames.md`, `/home/jody/github/serene-pub-sdk/sdk/src/descriptors.ts` (the one JSDoc).

## Out of scope

`docs/lorebook-cast.md`, `docs/characters.md`, `docs/images.md` (lane s4-cp), `docs/session-layout.md`, any code, NOMENCLATURE, INTEGRATING.

## Stop and ask (in your report) when

A sentence you need describes behaviour not in the summary above; a page's existing text contradicts the summary in a way you can't fix with a sentence; anything outside your files.

## Hard rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (Don't build at all.)
- Never `git checkout`/`restore`/`stash` in either repo.
- Prettier: `npx prettier --check` the changed `docs/*.md` from the app root; only fix lines you changed.

## Done means

The edits above; a docs test if the app has one for these pages (grep `docs` tests, e.g. a docs-compile or link test — run it capped:
`SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad; cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-live-w8-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w8-tests.log"`).

## Report (final message)

Each change as file:line with the new sentence(s) verbatim; sentences found false and fixed; tests run; stopped-and-asked; Noticed, not done.
