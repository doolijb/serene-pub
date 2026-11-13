# BRIEF playtest3-L3-w1 — own empty nickname on the server side + the pinned tests

Lane `playtest3-L3`, worker 1 of 2. Supervisor: playtest3-L3. Report: your final message (changed files, each test command with pass/fail counts, anything you could not do, Noticed-not-done). Worker 2 edits the member form files at the same time (`memberDraft.ts`, `memberDraft.test.ts`, `CastMemberForm.svelte`, `castMemberForm.dom.test.ts`, `docs/lorebook-cast.md`) — never touch those.

## Goal
The owner's rulings (2026-11-04):
- **★L-3:** "`nickname = ownNickname ?? card.nickname` — an own name alone keeps the card's nickname, which `resolveCharacterName` prefers when one word is shown."
- **★L-3b:** "a *Use from card* toggle on each of Name and Nickname. On (the default for a field with no own value): the card's value reads through … stored NULL. Off: the field is the book's own value, which MAY be blank — an own empty **Nickname** means *no nickname in this book* (the member shows by name), an own empty **Name** is refused (*A cast member's name in this book must be text.*, `OWN_NAME_NOT_TEXT`). Storage: `own_nickname` keeps `""` as a value … no migration … The rule stays `nickname = ownNickname ?? card.nickname` with `""` → none."

The supervisor has ALREADY changed `src/lib/shared/lorebooks/memberIdentity.ts` (do not edit it). Its contract now is:
- `ownNameValue(v)`: `typeof v === "string" ? v.trim() : null` — `""` is KEPT (an own empty value), no longer folded to null.
- `hasOwnNames(m)`: true when `ownName` is non-blank text, or `ownNickname` is any string (including `""`/`"  "`).
- `memberNames(m, card)`: `name` = own name if non-blank, else `card.name ?? ""`; `nickname` = own nickname when it is a string (`""` → `null`, i.e. none), else `card.nickname || null`.
- `memberShownName` / `withMemberNames` follow (nickname || name || fallback).

## Tasks
1. **`src/lib/server/lorebooks/castOwnNames.ts` → `normaliseOwnNames`.** New behaviour, per key, IN PLACE:
   - `undefined` → leave absent;
   - `null` → `null` (Use from card on);
   - not a string → return `OWN_NAME_NOT_TEXT`;
   - string → trimmed; for `ownName` a trimmed `""` → return `OWN_NAME_NOT_TEXT` (refused); for `ownNickname` keep `""`.
   Update its doc comment (and the file header if it says "blank = null"). Leave `providedCastProblem` code as is (with the new `ownNameValue`, `null` vs `""` now differs, which is right: switching to "no nickname" is a change). Do not change `OWN_NAME_NOT_TEXT`'s text.
2. **`src/lib/shared/lorebooks/memberIdentity.test.ts`** to the new contract: `ownNameValue("")` / `("   ")` → `""`; the `bare` list loses `{ ownName: "", ownNickname: "  " }` (move it to a new case: shows by the card's NAME, `hasOwnNames` true, `memberNames(...).nickname === null`); `hasOwnNames({ ownName: "" })` false, `hasOwnNames({ ownNickname: "" })` true; the ★L-3 case: `memberShownName({ ownName: "Maren", ownNickname: "" }, card)` is now `"Maren"` (own empty nickname = none), `{ ownName: "Maren" }` alone still `"Vee"`; fix "replaces name and nickname, keeps the rest" (`withMemberNames(card, { ownName: "Maren" })` now keeps `nickname: "Vee"`; add `{ ownName: "Maren", ownNickname: "" }` → `nickname: null`).
3. **The pinned tests, to the new rule — keep each case's intent.** Each fixture either gives the book an own empty nickname (`ownNickname: ""`, the new way to show the own name), gives the book a nickname, or asserts the card's nickname shows — whichever the case means; retitle a case whose title states the old rule ("drops the card's nickname"). Files and cases:
   - `src/lib/client/lorebooks/castPool.test.ts`: "an own name wins and drops the card's nickname"; "own names win over castPoolItem's cardName argument; none reads as today"; and line ~227 `toCastMember(mk({ ownName: null, ownNickname: "" }))` — `""` now means no nickname: the member shows by the card's NAME; fix the expectation and say so in a comment.
   - `src/lib/server/lorebooks/retold.int.test.ts`: "applyRetold gives the card the member's name and nickname; the same object for a member with nothing" (line ~148 `ownNickname: ""` is no longer "nothing": use `null` for the "nothing" case and add that `ownNickname: ""` yields `nickname: null`); also "replaces name and nickname, keeps the rest" if present there.
   - `src/lib/client/components/sessionPage/sessionPageProjections.castNames.test.ts`: "an own name shows"; "a turn candidate is named by the cast's own name"; "a seat shows as the member, with their face".
   - `src/lib/server/sessions/rowProjection.castNames.int.test.ts`: currently green; touch only if it fails, else leave.
4. **`src/lib/server/lorebooks/castOwnNames.int.test.ts`** — fix "an own name is the name; the card's names stay aliases" (card nickname "Vee": an own name alone now shows "Vee" as `name`; keep its intent — the own name is the member's name and the card's names stay aliases — e.g. assert with `ownNickname: ""` that `name` is `"Maren"`, or assert `name` "Vee" and the own name stored; pick what the title means and say which). Replace "a blank save stores null and the card's name comes back" with these new cases (★L-3b, Done means):
   - **Use from card on stores NULL and the card's reads through:** after an own name+nickname, `update({ ownName: null, ownNickname: null })` → both stored `null`, `row().name === "Vee"`.
   - **Toggle off + blank nickname stores `""` and the member shows by name:** card nickname "Vee"; `update({ ownNickname: "  " })` → stored `ownNickname === ""`, `row().name === "Verity Hale"`; and with `ownName: "Maren", ownNickname: ""` → `name === "Maren"`.
   - **Toggle off + blank name refused:** `update({ ownName: "  " })` and `update({ ownName: "" })` reject with `"A cast member's name in this book must be text."`, and the stored row is unchanged.
   - Update the file's header comment ("a blank save clears them" is no longer true).
   Keep the existing 60 s timeouts (`vi.setConfig`).

## Files owned (only these)
`src/lib/server/lorebooks/castOwnNames.ts`, `src/lib/server/lorebooks/castOwnNames.int.test.ts`, `src/lib/shared/lorebooks/memberIdentity.test.ts`, `src/lib/client/lorebooks/castPool.test.ts`, `src/lib/server/lorebooks/retold.int.test.ts`, `src/lib/client/components/sessionPage/sessionPageProjections.castNames.test.ts`, `src/lib/server/sessions/rowProjection.castNames.int.test.ts`.

## Files readable
Everything. Notably `memberIdentity.ts` (do not edit), `src/lib/server/sockets/lorebooks.ts` (~1670–1700: the update handler calls `normaliseOwnNames` before `providedCastProblem`; ~2680–2715: the import's `ownText`) and `src/lib/server/utils/lorebookExportBuilder.ts` ~193 — NOT yours: if you see they must change, write it in your report, never edit.

## Out of scope — never built
A stored marker column; a migration; any reader change beyond `""` meaning none; a toggle on Face; edits to any file not listed above (including `sockets/lorebooks.ts`, `lorebookExportBuilder.ts`, `NOMENCLATURE.md`); new names or error strings.

## Stop and ask when
A test's intent cannot be kept under the new rule (stop, say which and why, in your report); a reader turns out to carry its own copy of the nickname rule (report it, do not fix); anything needs a new name, setting or migration.

## Rules your work depends on (quoted)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never seed a row at a hardcoded id." "It is a **session**, never a *chat*."
- Lead: "An int test that opens a DB inside an `it` gets a 60 s timeout."
- Re-read every file immediately before editing it (worker 2 and other lanes are editing in the same tree). Use Edit, never Write, on existing files.
- Formatting: `npx prettier --check <file>` on each file you touched — never `--write`. Report any file it flags; fix formatting by hand with Edit.

## Done means
Green, each run with the command below: `memberIdentity.test.ts`, `castPool.test.ts`, `retold.int.test.ts`, `castOwnNames.int.test.ts`, `sessionPageProjections.castNames.test.ts`, `rowProjection.castNames.int.test.ts`; the new castOwnNames cases above present and passing.

Run vitest ONLY as (one log name per run, n = 1, 2, …):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-L3-w1-<n>.log 2>&1; echo exit=$?'`
then read the log (grep it). Never pipe vitest into `head`. Never a full `npm test`, `npm run check`, or project-wide `tsc`.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need an SDK build.)
