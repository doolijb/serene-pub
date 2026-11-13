# BRIEF — s4-follow-b-w3 (2026-11-09): Characters view favourites + nickname; member voice copy

Supervisor: lane s4-follow-b. You are a lane-worker. Report in your final message (the harness refuses report files): changed files, tests run and results, open questions, Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)

## Goal A — Characters view: favourites first, nickname shown (owner: "Should keep favorites."; chr-nick approved)

1. `src/lib/server/cast/characterRows.ts` — the keyset gains a leading **favourite rank**: in `candidateSql`, the card branch selects `CASE WHEN ${C.userId} = ${plan.askerId} AND ${C.isFavorite} = true THEN 0 ELSE 1 END AS fav_rank`, the member branch `1 AS fav_rank`; order and the `after` comparison become `(fav_rank, sort_name COLLATE "C", kind_rank, id)`. The cursor `Key` gains `f: 0 | 1` (`encodeCursor`/`decodeCursor`; decode now requires exactly keys `f,i,k,n` — an old three-key cursor is refused with the existing `CHARACTER_ROWS_STALE_CURSOR`, which the view already answers by asking for the first page again, no toast). Update the file's header comment ("One keyset over …") to name the new order. Only the asker's own favourite cards rank 0 (a shared card's star is its owner's, `isFavorite` stays false on other rows per the type's doc).
2. `src/lib/shared/characters/characterRows.ts` — `CharacterRow` gains 🚧 `nickname: string | null` with one JSDoc sentence: "The nickname the row is shown by first: the card's current version's on a card row, the cast member's as read on a cast member's row; null when none." Fill it in `buildRows`: card rows from `cardsNow` (it already reads the card's columns incl. `nickname` — check), member rows from the member as read (`membersAsRead` / `MemberAsRead` — use its shown nickname field if it has one; if it has none, null and say so). Blank strings → null.
3. `src/lib/client/components/listItems/CharacterRowItem.svelte` — every place the row shows its name (list and card modes, `itemName`, avatar initial, aria-label/title) shows `row.nickname || row.shownName` (one `$derived`, e.g. `shown`). Old list did exactly this: `{character.nickname || character.name}` (`CharacterListItem.svelte:107`).
4. `src/lib/client/components/sidebars/CharactersSidebar.svelte` — check it keeps the server's order inside each group (favourites first). If it re-sorts rows by name anywhere, keep the server order instead. Don't touch anything else in it.

## Goal B — member voice reads as an override (owner: "Add voice overrides to cast, a card is a seed, not the sole carrier.")

`src/lib/client/components/characterForms/VoiceTab.svelte` is the card form's Speech tab and is reused for a cast member's own voice in `src/lib/client/lorebooks/cast/CastMemberForm.svelte` (voice section, ~lines 1356–1382: a **Use from card** switch for a linked member; `VoiceTab` only while the member has its own voice; a card-less member always has its own).
1. `VoiceTab.svelte`: new optional prop `castMember?: { linked: boolean }` (absent = the card form, unchanged). One JSDoc sentence. Copy:
   - Header help (`Who speaks for {who} when a line is read aloud.`): for a **linked** member → `{who}'s own voice in this book, used instead of the card's.`; for a **card-less** member → unchanged.
   - **Spoken aloud** help: for any member, drop the sentence `Travels with the card.` (keep `Off, their lines stay text even when the session reads aloud.`). Card form unchanged.
   - Update the header comment to say it serves a cast member's own voice too.
2. `CastMemberForm.svelte` — **this file is lane s4-follow-a's; you have the lead's go for exactly two edits inside the voice section, nothing else.** Rules: exact-string `Edit` only (never `Write` the file); re-read the lines just before each edit (follow-a is editing the same file right now); do NOT run prettier on it at all.
   (a) `<VoiceTab characterName={member.name} bind:timbre={draft.timbre} />` → add `castMember={{ linked: !!member.linked }}`.
   (b) When the switch is on (`member.linked && draft.timbre === null`), a muted line under the switch: `<p class="text-surface-600-400 text-xs">Uses the card's voice.</p>` (match the classes the section's neighbours use for a muted line, if different).

## Files owned (only these)

`src/lib/server/cast/characterRows.ts`, `src/lib/shared/characters/characterRows.ts`, `src/lib/client/components/listItems/CharacterRowItem.svelte`, `src/lib/client/components/sidebars/CharactersSidebar.svelte` (order only), `src/lib/client/components/characterForms/VoiceTab.svelte`, the two edits in `CastMemberForm.svelte`, and tests beside them.

## Rules (quoted)

- STYLE-GUIDE §6.4: "A favourite is a small filled star after the name" (already drawn; keep it). "A **Characters row** (`CharacterRowItem` 🚧) is one row per character … a cast member with no card is a row of its own."
- STYLE-GUIDE §10: "Help is one sentence." "Sentence case everywhere."
- CLAUDE.md: "⚠ Must not statically import `$lib/server/db`" (header of characterRows.ts: every function takes its handle first). "Inside `db.transaction(async (tx) => …)` use only `tx`."
- Owner principle: "not having a card doesn't make them 2nd class" — a card-less row shows its own nickname the same way.
- Prettier: `npx prettier --check` changed files, `--write` only lines you changed; never reformat a whole file; never prettier `CastMemberForm.svelte`.

## Stop and ask when

A name beyond `nickname`, `castMember`, `fav_rank`/`f` is needed; `MemberAsRead` has no nickname; any copy beyond the strings above; a fix needs another file.

## Tests (done means)

Capped scope, logged (never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-b-w3-tests.log'`
An int test that opens a DB inside an `it` needs a 60 s timeout.
1. New `src/lib/server/cast/characterRows.favorites.int.test.ts`: favourites first, then the rest by name; paging with a small `limit` across the favourite/non-favourite boundary returns every row exactly once, in order; a three-key cursor is refused with `CHARACTER_ROWS_STALE_CURSOR`; another person's favourite (shared card) doesn't rank first; `nickname` filled on a card row and a card-less member row (if the member read has one).
2. `src/lib/client/components/listItems/characterRowItem.dom.test.ts` (add cases): nickname shown first in list and card modes; name when no nickname.
3. `src/lib/client/components/characterForms/voiceTab.test.ts` (or a new `voiceTab.dom.test.ts` if that one is not a DOM test): card form keeps "Travels with the card."; linked member shows the override line, no "Travels"; card-less member shows the plain header, no "Travels".
4. Re-run existing: `characterRows.int.test.ts`, `characterRows.sharedCards.int.test.ts`, `characterRows.storedNames.int.test.ts`, `src/lib/client/components/sidebars/characterRowsView.test.ts`.
Report `npx tsc --noEmit -p .` errors in your files (12G scope: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > <scratchpad>/s4-follow-b-w3-tsc.log 2>&1'`); if another `tsc --noEmit` is running (`pgrep -af "tsc --noEmit"`), wait for it first. Known errors not yours: 3 in `sessionPage/requests/*` waiting on `sdk:build`.

## Report

Final message: changed files; tests + results; tsc; copy used; open questions; Noticed, not done.
