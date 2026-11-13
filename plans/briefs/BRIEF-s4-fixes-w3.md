# BRIEF s4-fixes-w3 — the member timbre check, and names claimed by base name (2026-11-08)

Supervisor: lane `s4-fixes` (wave 5). Report back to the supervisor in your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

Two independent parts. Do Part A first (the owner said "fix now").

---

## Part A — the cast-member save path runs `validateTimbre` (security gap)

**Owner 2026-11-08:** "Timbre gap → fix now (member save path runs `validateTimbre` like cards)."

**The gap:** a cast member's voice is its `timbre` (`CharacterTimbreInput | null`; frozen member key — the value lives on the member's versions, written by `writeMemberEdit` in `src/lib/server/sockets/lorebooks.ts` ~1541). `lorebooks:createBinding` (~2107) and `lorebooks:updateBinding` (~2286) accept `timbre` from the client and write it with no check, so a **non-admin** can store a voicebank `voice` / `narrationVoice` — which members must not pick (only the client's picker is admin-only).

**The card rule** (`src/lib/server/characters/timbre.ts`): `validateTimbre(input, { db, canPickVoice, previous })` — refuses a bad language / out-of-range setting / unknown voicebank slug with a reason; without `canPickVoice` the **previous** `voice`/`narrationVoice` are kept whatever was sent; `null` clears (but without `canPickVoice` keeps the previous voices). `canPickVoice(user)` is in `src/lib/shared/characters/timbre.ts` (admin only). The card socket wraps it in `applyTimbreUpdate` (throws the reason; the handler emits it as the `:error`).

**Do:** in both handlers, when the sent binding has a `timbre` key (`"timbre" in …` and not `undefined`), run `validateTimbre(sent.timbre, { db, canPickVoice: canPickVoice(socket.user), previous })` **before** the transaction; on `{ ok: false }` throw `new Error(reason)` (both handlers are `refusable(...)`, so a thrown Error is the refusal); on ok, replace the sent value with `result.timbre`. One small private helper in `sockets/lorebooks.ts` used by both is fine.
- `previous`: update → the member's stored timbre as the form sees it (`storedMember.timbre`, from `castMemberRowsOf`, already read in the handler) `?? {}`; create → `{}` (a new member has no voice to keep).
- **`null` on a carded member means "Use from card"** (the member page's switch, lane s4-cp: "on = `timbre` null"; `characters/versions.ts` ~262 — an own timbre stops following the card's). So for a member that is (or, on this update, becomes) linked to a card, pass `null` through as `null` — following the card picks no voice. For a card-less member, `null` goes through `validateTimbre` like a card's clear (keeps the previous voices for a non-admin). The supervisor decided this; don't change it.
- Only the `timbre` key. Don't touch anything else in this file (it's shared with other lanes; this lane owns "the timbre check only").

**Tests** — new `src/lib/server/sockets/lorebooks.memberTimbre.int.test.ts`, templated on an existing `sockets/lorebooks.*.int.test.ts` that drives `updateLorebookBindingHandler` / `createLorebookBindingHandler` with a fake socket (e.g. `lorebooks.memberName.int.test.ts` or `lorebooks.castVersions.int.test.ts`; seed a `voicebankVoices` row — find its required columns in `src/lib/server/db/schema.ts`). Cases:
1. non-admin update sending `timbre: { voice: "<real slug>" }` on a member with no voice → stored timbre has **no** voice (kept previous = none); other fields (description/language) saved.
2. non-admin update on a member whose admin-set voice is `A`, sending `voice: "B"` → `A` kept.
3. admin update sending `voice: "<real slug>"` → stored.
4. admin update sending an unknown slug → refused with `No voice named "…" in the voicebank.`; nothing written.
5. a bad language (`"english"`) → refused for anyone.
6. non-admin **create** with a `voice` → stored without it.
7. carded member, non-admin, `timbre: null` → stored timbre null (follows the card).
Read the stored timbre the way the form does (`castMemberRowsOf` or `membersAsRead` / the member's versions — whichever the template uses).

---

## Part B — ★cp-names-1: names claimed by base name, then the dated-rename write-back

**Owner ruling 2026-11-08:** "★cp-names-1 → **Both, via base name**" (members claim vocabulary names by their **undated-Main shown name**, so R1 "hybrid" 2026-09-30 holds; a dated rename is written back to `lorebook_bindings.name` **for sort/search only**).
**R1 "hybrid" (owner 2026-09-30, plan C1, quoted in `annotations/index.ts` ~300):** "An amended name never takes a name another member or entry already holds."

Background (lane s4-cp's report): a hook that wrote a dated Main rename into `lorebook_bindings.name` broke 3 `amendedNames.int` tests, because `loadVocabulary` claims names by the **stored** name: a carded member renamed by a dated version lost its card's name from the vocabulary, and a member renamed onto another's name competed for it as a stored name. Fix the vocabulary first, then add the hook.

### B1 — `src/lib/server/annotations/index.ts`

- **`loadVocabulary` (~315):** each member's claimed name is its **base shown name**, not `lorebook_bindings.name`. The base is the member's version with `castMemberId` = member, `cardId` null, `branchId` null, `year` null, `personalPosition` null, `sourceSessionId` null (the `character_versions_base_idx` key; see `baseVersionsOf` in `sockets/lorebooks.ts` ~1293 and the same query in `src/lib/server/utils/characterBindingSync.ts` ~152–207). Its shown name is computed exactly as `characterBindingSync.ts` ~196–208 does (`memberColumnsOfVersion(base, { carded: true })` from `$lib/server/lorebooks/retold` for own names when `base.parentVersionId != null`, then `memberShownName(names, parent)` from `$lib/shared/lorebooks/memberIdentity` with the parent card version's `name`/`nickname`); a card-less base's shown name is its own `name`. A member with no base (shouldn't happen) falls back to the stored name. Aliases and absorbed aliases stay as they are read today (`bindingNames` minus the stored name, plus the base name — read `bindingNames` and keep its order/trim rules). One batched query for the book's bases and one for their parents — no per-member queries.
- **`amendedNamesOf` (~230):** for a cast version whose `follows` includes `"name"` and that has a `parentVersionId`, also add the **parent card version's** `name` and `nickname` (trimmed, non-empty, deduped as today). Keep the existing order rule (write order, then id) — add the parent's names at the version's place. One extra batched query (or a self-join) for the parents.
- Update the two JSDoc blocks in a sentence each (base name claims; parent card names for following versions). `takenNames` in `bindingSuggestions/index.ts` reads `amendedNamesOf` and must keep working **unchanged** (not your file).
- Hash: books whose stored names equal their base names must keep the same vocabulary hash (no mass re-annotation). Add a test for that.

### B2 — the hook in `src/lib/server/characters/versions.ts` (this lane owns **the hook only**)

After a cast-version write or edit that can change what the member shows at its book's present, set `lorebook_bindings.name` to the member's `shownName` from `membersAsRead(tx, [memberId])` (`src/lib/server/cast/memberAsRead.ts`; default options read the book's present on Main) when it differs. Sites: `writeCastVersion` (~1643, both the story and author paths — just wrap the dispatch), `updateCastVersion` (~2011, every return path), and `deleteCastVersion` (~2222). One private helper, called with the member id after the write. Import `membersAsRead` **dynamically inside the helper** (as `followCardGreetingsAfterLift` does with `./versionsLift`) to keep `versions.ts` free of a load-order cycle. Only for versions on Main (`branchId` null before or after); skip when the write is on a line. Keep it ~10–15 lines. Don't touch anything else in `versions.ts`.

Don't change `utils/characterBindingSync.ts` (not this lane's). If you find the sync overwrites the hook's name (a card edit writes the **base** shown name while a dated rename is in force), note it under Noticed, with file:line.

### Tests for Part B (Done means)

- `src/lib/server/cast/characterRows.storedNames.int.test.ts`: flip the last `test.fails` ("a dated cast version on Main that renames the member") to `test` and delete its `// FAILS (held back…)` comment line. All tests in the file pass, none `.fails`.
- `src/lib/server/annotations/amendedNames.int.test.ts` stays green **unchanged** (don't edit it).
- Add to a new `src/lib/server/annotations/baseNameVocabulary.int.test.ts`: (a) a carded member renamed by a dated Main version (so its stored name is now the new name via the hook) still answers to its card's name and the new name, and the stored name is the new name; (b) member Vell renamed by a dated version onto another member's name "Rook" → "rook" resolves to Rook's member; (c) the hash of a book with no amendments is the same before and after your change — compare `loadVocabulary(...).hash` against a hash computed the old way, or (simpler) assert it equals the hash of a second book with identical stored/base names; pick something that would catch a regression and say what you chose.
- Neighbours green: `annotations/castMemberVocabulary.int.test.ts`, `annotations/versionNames.int.test.ts`, `annotations/castTagAnnotations.int.test.ts`, `bindingSuggestions` tests that call `takenNames` (find them), `characters/versions*.test.ts` that exist (list them), `sockets/lorebooks.castVersions.int.test.ts`, `sockets/lorebooks.memberName.int.test.ts`.

Run tests only like this (capped scope, logged; never pipe vitest into `head`):

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-fixes-w3-tests.log 2>&1; echo test-exit=\$? >> $S/s4-fixes-w3-tests.log"
```

Then `npx tsc --noEmit -p .` under a 12G scope (`-p MemoryMax=12G`, `NODE_OPTIONS=--max-old-space-size=8192`), logged to `$S/s4-fixes-w3-tsc.log`. Baseline 0 errors.

## Files you may edit

`src/lib/server/sockets/lorebooks.ts` (the timbre check only), `src/lib/server/annotations/index.ts`, `src/lib/server/characters/versions.ts` (the hook only), `src/lib/server/cast/characterRows.storedNames.int.test.ts` (the flip only), and the new test files named above. Read anything. Another worker is editing `src/lib/server/state/**`, `sockets/state.ts`, `sessions/convertRuleset.ts` — don't touch those. Lane s4-st owns `cast/characterRows.ts`, `cast/cardless.ts`, `lorebooks/tableRegistry.ts`, `lorebooks/starterKits.ts`, `plugins/*` — don't touch.

## Stop and ask (in your report, don't decide) when

- A refusal sentence other than `validateTimbre`'s own reasons would be needed (new user-visible copy).
- The base-name rule changes which entity a name resolves to in any existing test other than the `test.fails` flip.
- The hook would need to run somewhere other than the three functions named, or the sync must change for the storedNames tests to pass.
- Anything needs a new exported name, a migration, or a file outside your list.

## Rules that apply (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test." (The hook gets the `tx` the write was handed — never import `db`.) · "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- NOMENCLATURE §24: "Grep for it first … Never ship a second meaning." Keep new helpers private; list every new name.
- An int test that opens a DB inside an `it` needs a 60 s timeout.
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. `sockets/lorebooks.ts` and `versions.ts` are large shared files: never `--write` them whole.

## Verbatim rules

- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.

## Report (final message)

Changed files with one line each; every new name; tests run with pass/fail counts and log paths; tsc before/after; decisions made (each named); stop-and-ask items; **Noticed, not done**.
