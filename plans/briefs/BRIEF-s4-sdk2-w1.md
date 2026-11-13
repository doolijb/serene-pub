# BRIEF s4-sdk2-w1 — SDK: cast members in card actions, Backdrop, owed JSDoc, INTEGRATING; sdk:build + sdk:test (lane s4-sdk2, wave 6) — 2026-11-08

Supervisor: lane `s4-sdk2`. Repo: **`/home/jody/github/serene-pub-sdk`** (edit here); commands run from **`/home/jody/github/serene-pub`**. Absolute paths only. Report in your final message: changed files, tests run with results, repins (old → new, why), decisions, open ★ (one recommendation + trade-off each), Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

- Never `git checkout` / `restore` / `stash` / `clean` in the SDK repo (most of it is uncommitted).
- Build only with `cd /home/jody/github/serene-pub && npm run sdk:build`; test with `npm run sdk:test` (the SDK's own suite). `sdk:test` after **every** SDK edit batch. Log to a file in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/` named `s4-sdk2-w1-*.log`; never pipe a test run into `head`.
- **Prettier:** `npx prettier --check` changed files, but `--write` only lines you changed; if a file fails only on lines you didn't touch, leave it and say so.
- A core component (`core-catalog/components/**`, `shared/ui/**`) never imports rulesets, compendium JSON or registries. Never add a `svelte` import to a package that has none.
- Catalogue ids evolve **in place at `@1`** — no `@2`.

## Rules your work rests on (quoted)

- **Modder rule (owner 2026-11-08):** "plugins never parse ref strings (typed host-filled fields and helpers); one JSDoc sentence per new field; INTEGRATING + guide examples updated in the same change; a refusal says what to do instead; every removed/renamed published name gets a migration note (old → new, one example)." The SDK should feel like Drizzle: typed, one way.
- **Ruling ★7 (2026-11-08):** "Member sprite-set editor + portrait/sprite-fill actions taking an owner (card or member) in S4."
- **NOMENCLATURE R3:** qualify, never the bare noun. Mark new provisional vocabulary 🚧. It is a **session**, never a chat. Every session has a lorebook (own book or overlay) — never write copy that says a session has none.
- Additive only: no published name is removed or renamed in this brief.

## Goal

1. **`core:inlet/card-action@1`** (`contracts/src/inlets.ts` ~935–1000). The action may now be pressed on a **cast member** (the member page's Sprites tab) as well as a card.
   - Add port `castMemberId: S.rowIds` beside `characterId`, with one JSDoc sentence: 🚧 the cast member the action was pressed on (host-filled); then `characterId` is null and the action's writes go to the member's own sprite sets / gallery.
   - `characterId`'s JSDoc: the card the action was pressed on; null when it was pressed on a cast member.
   - `entities`: add `castMemberId: 'cast-member'`.
   - The head comment: pressed on a card **or a cast member**; the host checks the person may act on it (a card: its owner or an admin; a cast member: whoever may edit the member's lorebook) and resolves its likeness once (a member's from the member as the story reads it). `main` is `{ characterId, castMemberId, fields }`.
   - Report: how the executor treats a `rowIds` port whose value is `null` (allowed? dropped? refused?) so the app supplies the right "absent" value for card runs (`castMemberId`) and member runs (`characterId`).
2. **`core:outlet/attach-sprite@1` and `core:outlet/offer-media@1`** (`contracts/src/outlets.ts` ~1222–1320): **no new ports.** JSDoc only: on a run pressed on a cast member the host files the pictures as the member's own sprites / gallery pictures (the files become the member's lorebook owner's, the lorebook as provenance) and ignores nothing silently — a wired `characterId` must be empty on such a run; refused unless the run's person may edit the member's lorebook. The card rule stays as written.
3. **Events** (`sdk/src/events.ts` ~719–757 `spritesAttached`, `mediaOffered`): JSDoc + `description` say the payload also carries 🚧 `castMemberId` — set when the pictures went to a cast member, and then `characterId` is null. If a typed payload interface for either event exists anywhere in the SDK (grep), add `castMemberId?: number | null` with one JSDoc sentence; if none exists, don't invent one — say so.
4. **`WidgetRequests['character-images']`** (`sdk/src/widgets.ts` ~1886): params become `{ characterId?: number | null; castMemberId?: number | null; cursor?: string }` with JSDoc: name the member by its card (`characterId` = `SessionCharacterV1.cardId`) when it has one, else by its `castMemberId` (host-filled on `SessionCharactersV1.members`); exactly one; the host refuses both or neither in words ("Name a character or a cast member, not both."). Update the request's head comment (a card-less member's gallery is the member's own pictures). Check `sdk/src/widgets.ts` ~2847 (`scope`) / ~2972 tables need nothing.
5. **Backdrop widget** (`core-catalog/components/shared/backdrop/BackdropWidget.svelte` ~56–170, ~238–260): today it keys galleries and the picked member by card id (`cardOf(m) = m.cardId ?? m.characterId`). Key them by the member's `ref` (string) instead, and ask `character-images` with `{ castMemberId: m.castMemberId }` when `m.cardId === null && m.castMemberId != null`, else `{ characterId: m.cardId ?? m.characterId }` (an older host fills no `cardId`). No new visible words. Look at Scene Portraits (`core-catalog/components/shared/scene-portraits/ScenePortraitsWidget.svelte` ~98–140): **do not change it**; report whether a card-less member breaks there.
   - Tests: find the existing Backdrop widget tests (grep `BackdropWidget` / `backdrop` under `sdk-tests/` and `core-catalog/`) and add: a card-less member (`cardId: null`, `castMemberId: 7`) asks `character-images` with `{ castMemberId: 7 }` and no `characterId`; a carded member still asks with `characterId`. Heavy DOM tests run in a capped scope (`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet …`).
6. **`SessionCastV1`** (`sdk/src/participants.ts` ~399–520) — JSDoc owed (verbatim):
   - on `sessionCharacters[]` (the array's doc, or `character`'s): _"`character` is card-shaped but has no `id` or `userId` for a card-less seat; read `ref` and `castMemberId`. `seatedByUserId` is the person who seated it and acts for it."_ — and declare `seatedByUserId?: number | null` on the seat row with a one-sentence JSDoc if it is not declared.
   - add `currentCastMemberId?: number | null` on `SessionCastV1` with: _"🚧 The member speaking a card-less seat's turn, from the scope; set only when `currentCharacterId` is null."_
7. **INTEGRATING** (`/home/jody/github/serene-pub-sdk/INTEGRATING.md`, §1k "Character profile and cast members", ~1351–1375). Add bullets (short, plain):
   - card actions on a cast member: `castMemberId` on `core:inlet/card-action@1`; `attach-sprite` / `offer-media` write to the member's own sets / gallery; `sprites-attached` / `media-offered` carry `castMemberId`;
   - `character-images` takes `castMemberId` for a card-less member;
   - `SessionCastV1`: the two sentences of 6;
   - **★st-2 (verbatim):** _"`library-characters` leaves out a provided book's carrier cards; read a member's `cardId` through `core:query/cast-member@1` and write it by id with `update-character@1`."_
   Then grep `guides/**` for `character-images`, `card-action`, `cardAction`, `sprites-attached`, `SessionCastV1`, `currentCharacterId`; update any example that would now mislead (e.g. a Backdrop-like widget example keyed by card id). Name each guide you changed or "none needed".
8. **The respond `speaker` wiring** (`core-catalog/src/genres/story/respond.ts` ~1056, and Chat/Guide respond `context` nodes): **do not change.** The app's `src/lib/server/pipelines/boot/specHashes.test.ts` pins those specs' hashes; report which pins would move.
9. **Build and test.** `pgrep -af "vite dev"` → if empty, `npm run sdk:build`; then `npm run sdk:test`. Known reds only (4): K-2 `deriveDontSpell` speakMessage; a ruled count 18/17; surface F1 `CREATE_SESSION_PERSONA_*_MAX`; vocabulary `your-first-plugin.md` "run". Any other red your change caused: fix it, or re-pin a hash/golden that moved **on purpose** with a dated comment `// Moved 2026-11-08 (lane s4-sdk2, ★7): <why>. (was '<old>')`. Report the final pass/fail counts and the build result. Also run the app typecheck once after the build to see nothing in the app broke on the widened request params: `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-sdk2-w1-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-sdk2-w1-tsc.log'` — report errors, **don't fix app files** (the supervisor does).

## Files owned

`/home/jody/github/serene-pub-sdk/contracts/src/inlets.ts`, `contracts/src/outlets.ts`, `sdk/src/events.ts`, `sdk/src/widgets.ts`, `sdk/src/participants.ts`, `core-catalog/components/shared/backdrop/**`, `INTEGRATING.md`, `guides/**`, `sdk-tests/**` (new tests + dated repins), core-catalog tests next to the Backdrop widget. Nothing in `/home/jody/github/serene-pub/**` or `/home/jody/github/mundi-sp/**`.

## Out of scope / stop and ask

- Any new port on an outlet; any new published name beyond `castMemberId` (inlet port), `currentCastMemberId` / `seatedByUserId` (typed fields the host already fills); any rename or removal.
- Scene Portraits behaviour; turn candidates' `castMemberId` (★f-emit-1, not this lane); anything a player sees beyond the two JSDoc'd fields.
- A failing test you didn't cause: list it, don't fix.

## Done means

SDK edits as above; a Backdrop test for the card-less ask; `sdk:build` clean; `sdk:test` known reds only (counts reported); app `tsc` result reported.
