# BRIEF — s4-fold worker 3 — `foldInParent`: the fold's core transaction and its guard — 2026-11-08

Supervisor: lane `s4-fold` (brief `plans/briefs/BRIEF-s4-fold.md`). You are a lane-worker; you cannot spawn agents. A later worker (w4) adds the notes-member fold (★bk-fold-3), member overlays and the remaining Done-means on top of your file, so build it in clear steps (one private function per step) that w4 can slot into.

## What the fold is (owner rulings — quote, never reinterpret)

- ★27-10 (2026-11-05): _"All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data storage API is predictable. No swapping lorebooks. But [own books] can be surfaced and **overlays can have their parent merged in place**."_
- ★B-1 (2026-11-08): **the fold copies the whole parent** — every line; the session's line remapped.
- ★B-2 (2026-11-08): button **Merge ‹book› into these notes**; confirm _"‹book›'s entries, cast, lines and dates are copied in, your changes stay on top, and from then on the session reads only its notes. ‹book› is not changed."_
- ★bk-fold-1: _a session on its own notes reads them on its own line and moment_ — **built** by worker 1: `state/reading.ts` `sessionReadingOf` now answers for a session with `lorebook_id = null` with the reading on its own book (line `sessions.lorebook_branch_id`, its clock, `onOwnBook: true`), and the union readers (`ownBook.ts` `sessionEntriesAsRead`, `cast/memberAsRead.ts`, places) read the own book at it.
- ★bk-fold-2: **built** by worker 2: `sessions/seatKeys.ts` exports `rekeySessionRefs(tx, sessionId, translate)` and the pure `memberMoveTranslator(moves: ReadonlyMap<number, number>)` — moves `seated_member` owners and `seated-member:<id>` refs of one session in all 15 stores (owner columns, proposals, annex, widget settings, message speakers/blocks, rewind records, annex deltas). Use them; never parse a ref string yourself.
- ★bk-fold-4: **re-file the notes' own world rows after the copy** (new ids, same anchors and dates) so _"your changes stay on top"_ — `inForce` (`state/resolve.ts` ~534) ties on the higher id, so without this P's copied undated value beats O's own.
- ★bk-fold-5: **move this session's scene captures** from P to the copies. Done-means: _"P byte-identical except this session's captures"_.
- 2026-11-05: _"Data wise, the session is a patron of the lorebook and branch, it doesn't own it."_ — the fold never writes P (except ★bk-fold-5's captures).
- Memory rule "There is ALWAYS a lorebook": never write code, comments or sentences framing a session as having no lorebook — own book / own notes / attached book.

Terms: **S** the session; **P** its attached book (`sessions.lorebook_id`); **O** its own book (`ownBookOf(db, S)`, `lorebooks.session_id = S`, `O.overlay_of = P`); **M** a member of P, **M′** its copy in O (`maps.bindings.get(M)`).

## Build `src/lib/server/lorebooks/foldInParent.ts` (new; lorebooks module owns it, P2)

```ts
/** 🚧 … one JSDoc paragraph: what the fold does, the rulings, that P is never written but for this session's captures. */
export async function foldInParent(
	db: Db,
	input: { sessionId: number; userId: number }
): Promise<{ lorebookId: number; foldedFrom: { id: number; name: string } }>
```
(`lorebookId` = O; `foldedFrom` = P's id and name, for the socket's reply and toast.) Refusals throw `OwnBookRefusal` (exported by `lorebooks/ownBook.ts`) with the sentences in `src/lib/shared/lorebooks/sessionNotes.ts` **`FOLD_REFUSALS`** (already written by the supervisor — import them, never retype): `missing`, `notOwner` (only `sessions.user_id` may fold), `alreadyOwn` (`lorebook_id` is null — a second fold), `readsDifferently(book)` (the guard). P must be readable by the user (`assertReadableBook` from `$lib/server/utils/ownedBook`, as `cloneWithChanges` does). Don't import `$lib/server/db` statically — the handle is the first argument.

**One `db.transaction`**, using only `tx` inside (CLAUDE.md Hard rule: _"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test"_). Steps, each a private function:

1. **Lock** `pg_advisory_xact_lock` on P and on O (lower id first); re-read the session inside the transaction and refuse `alreadyOwn` if `lorebook_id` is already null (a fold that raced).
2. **Guard snapshot "before"** (see Guard below).
3. **End Forward:** `discardForwardStack(tx, S)` (`messages/store.ts`) — ★pl4-1: a Back-stashed row must never come back onto owners the fold moved.
4. **Copy:** `const maps = await copyLorebookTables(tx, P, O, { keepTurnTies: true })` (`lorebooks/tableRegistry.ts`; copies every registered table into a non-empty target: fresh `{{char:N}}` tags when O already holds members (`maps.tags`), clashing line names → `name (2)`, target suggestions/sheets win, the template layer only — `session_id IS NULL` — of the attribute tables). Read the registry first: what it copies, what it leaves (`notCopied`), and the scenes spec (copies arrive capture-less: `sessionId: null`).
   **Before the copy**, `lorebook_bindings_character_unique` (`schema.ts` ~1752) would throw when O holds a member N for a card P's member M also holds — that is ★bk-fold-3, worker 4's. For now: detect it and throw a plain `Error("foldInParent: notes member <N> holds card <X> that <M> holds — not handled yet")` so the case fails loudly; w4 replaces it.
5. **P's book facts into O:** `story_calendar`, `story_clock_*` (year…minute), `primary_ruleset`, `ruleset_version`, and the annex (`annex`, `annex_audiences`, `annex_versions`). For the annex, first read how a session with an attached book reads the annex today (`lorebooks/annex.ts`, `unionAudiences` ~240, and the annex document readers) and make O's annex after the fold equal to what S read before (P's under O's, or however the union reads). `next_binding_number`: the registry's empty-target path leaves it to the caller (bk-fold noticed) — make sure O's counter is above every tag O now holds.
6. **The session's line:** `sessions.lorebook_branch_id = maps.branches.get(old) ?? null` (old null → null = main); the session's clock (`sessions.story_clock_*`) is kept untouched. Write it directly (the settings handler refuses a branch with no shared book — not your concern).
7. **★bk-fold-5 captures:** this session's scenes filed in P (`scenes.session_id = S and lorebook_id = P`) move to O — `lorebook_id`, `branch_id` and `history_entry_id` through `maps`, their `scene_characters.binding_id` through `maps.bindings` — and the registry's capture-less duplicate of each (`maps.scenes.get(id)`) is deleted. Check `scenes_open_per_session_channel` can't collide.
8. **O's own rows that named P's rows** now name the copies (as `cloneWithChanges` did for its copy — see the reference below): O's entries `anchor_entry_id` / `anchor_binding_id`; O's `narrative_relationships` `from/to_entry_id`, `from/to_node_id`; O's `extra_json.ruleFed` (`entryFields` and `placeValues` keyed by P entry ids, `castStates` by P member ids) rekeyed through `maps`; entity keys in O's annotations (`entry:<id>`, `cast_member:<id>` — `remapEntityKey` in tableRegistry); any other O row holding a P id you find in the schema (list them).
9. **The session's own rows that named P's rows** (every table with a `session_id`, the session layer): attribute rows (`attribute_values`, `attribute_configs`, `owner_sheets`, `attribute_carries`, `zone_contents`) with `session_id = S` whose owner is `cast_member` M → M′, `location` P-entry → copy, `lorebook` P → O; `lore_imprints` (entry / member subjects, and their `lorebook_id`); `cast_presences` or others with a session column naming P rows; check `state_proposals` payloads naming P owners. Enumerate from `schema.ts` (grep every `sessionId` column and every FK to `lorebook_bindings` / `lorebook_entries` / `lorebooks`) and list what you moved and what you judged not to name P.
10. **Members re-pointed M → M′** with `moves = new Map([[M, M′] for every M in maps.bindings])`:
    - **seats:** 🚧 `reseatOnto(tx, sessionId, moves)` — new export in `src/lib/server/sessions/seats.ts` (that function only): `session_characters.cast_member_id` and `session_personas.cast_member_id` of S in `moves` set to the target; nothing else on the seat changes (`character_id`, `seated_by_user_id`, position, departed stay). One JSDoc sentence. §33 once dropped a `reseatOnto` with a hand-off meaning — this one only re-points seats of one session after a fold.
    - **speaker stamps:** `session_messages.cast_member_id` of S's rows naming a moved member → the target. Export `restampSpeakers` from `messages/store.ts` (add `export`, nothing else in that file) and use it if it re-stamps from the seats you just re-pointed; if a direct `update … set cast_member_id` through `moves` is the simpler exact form, do that and say why in your report (the brief names `restampSpeakers`; either is fine, P1 — same result).
    - **state refs:** `rekeySessionRefs(tx, S, memberMoveTranslator(moves))`.
    - Sprite sets: the registry copies a member's own sets (`maps.spriteSets`); check whether any session-side row (a seat's chosen set, `widget_settings.chosenImages`) names a sprite set id of P and re-point it through `maps.spriteSets`.
11. **★bk-fold-4 re-file O's own world rows:** O's template-layer rows owned by the book itself (`owner_kind = 'lorebook' and owner_id = O`, `session_id is null`) in `attribute_values` and `attribute_configs` **that existed before the copy** (read their ids before step 4) are re-inserted after the copy with new ids — every column the same (anchors `history_entry_id`, `branch_id`, `valid_from_message_id`, `source_*`, `scene_id`, value, note…) — in their original id order, and the originals deleted. If the re-file needs a writer in `state/write.ts`, it is yours (the re-file hunk only); a local function in `foldInParent.ts` is fine.
12. **The session reads only its notes:** `sessions.lorebook_id = null`, `O.overlay_of = null`; `updated_at` on the session row.
13. **Guard snapshot "after"** and compare; any difference → `throw new OwnBookRefusal(FOLD_REFUSALS.readsDifferently(P.name))` inside the transaction (rolls everything back).

### Guard

Inside the transaction, before step 3 and after step 12, read with `tx`:
- **members:** for every live seat of S, `seatMembersAsRead(tx, S, rows)` (`pipelines/prompt/seatCards.ts` ~140; the seat rows as the session page reads them), and `membersAsRead(tx, ids, { sessionId: S })` for every member of P plus O's own non-overlay members;
- **entries:** `sessionEntriesAsRead(tx, S, "session", null)` (`lorebooks/ownBook.ts`).

Compare a **content projection**: map "before" ids through `maps` (M → M′, P entry → copy, P branch → copy) and drop fields that name the book or are expected to change (`id`, `lorebookId`, `branchId`, `historyEntryId`, `sessionOnly`, …) — list every dropped field in the JSDoc and the report. The rest (shown name, name, profile fields, active card, follows, face, voice, sprite set, tags, entry title/content/keys/fields/type…) must be equal. A difference names the member or entry and the field in the thrown error's `cause` (for the server log), while the message stays the `readsDifferently` sentence. **If a test fixture makes the guard fire and you can't trace it to a fixable step, stop and describe the fixture in your report** (that is a supervisor stop-and-ask).

Interpretation (supervisor): reads are compared at the session's current reading; "at every live message" in the Done-means is covered by the Back/Forward tests (worker 4) — say so in the JSDoc.

### Reference

`cloneWithChanges` (being removed by another worker right now, in parallel) did steps 3, 6–9 for a *new* copy; a snapshot of its code is at `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-clone-reference.ts` (lines 1104–end of the old `ownBook.ts`) and its test at `…/scratchpad/s4-fold-clone-test-reference.ts` — reuse the logic, never import from them. **Do not edit `lorebooks/ownBook.ts`** (another worker is removing the clone from it now); import `ownBookOf`, `OwnBookRefusal`, `sessionEntriesAsRead` from it.

## Tests (Done means) — new `src/lib/server/lorebooks/foldInParent.int.test.ts` (60 s timeouts for DB work in `it`; fixtures as in `tableRegistry.copyInto.int.test.ts` and the clone reference test)

- **Main-line fold:** S on P's main, no clock; P with entries (undated + dated), members with versions, a place, world/cast/place values, a line `Night`; O with its own entry anchored to a P entry, a ruleFed entry field, an own world value on a slot P also fills (★bk-fold-4). After: `lorebook_id` null, `O.overlay_of` null, `lorebook_branch_id` null; every seat on M′; message stamps M′; a `seated-member:M` widget/annex ref → M′; `sessionEntriesAsRead` / `membersAsRead` / `seatMembersAsRead` project equal (the guard passed); O's world value is still the one read; `Night` exists on O.
- **Line + clock fold:** S on P's line `Night` with a session clock; dated rows on main after Night's fork and on Night. After: `lorebook_branch_id` = Night′ (on O); clock unchanged; reads equal.
- **Captures (★bk-fold-5):** S's scene in P moves to O with its cast on M′; the copy's duplicate gone; another session's scene in P stays in P.
- **P byte-identical except S's captures:** dump every registry table's rows for P (`to_jsonb` of each row, ordered by id) before/after; equal except S's scene rows.
- **Second fold refused** with `FOLD_REFUSALS.alreadyOwn`; a non-owner refused with `notOwner`.
- **Rollback:** force the guard to fire (e.g. a test-only fixture that the projection can't map — or `vi.spyOn` a reader to return a different value on its second call) → `readsDifferently` thrown, and S, O and P are exactly as before (dump compare).
- **`restampSpeakers` export / `reseatOnto`:** a small test each if not covered above.
- Also run, unchanged and green: `src/lib/server/sessions/seatKeys*.test.ts`, `src/lib/server/sessions/seats*.int.test.ts` touching your hunk, `src/lib/server/messages/store*.test.ts`, `src/lib/server/lorebooks/tableRegistry*.test.ts`.
- tsc: no new errors in your files.

## Files owned

New `src/lib/server/lorebooks/foldInParent.ts` + `foldInParent.int.test.ts`; `src/lib/server/sessions/seats.ts` (`reseatOnto` only); `src/lib/server/messages/store.ts` (the `export` on `restampSpeakers` only); `src/lib/server/state/write.ts` (a re-file writer only, if you need one); `src/lib/server/lorebooks/tableRegistry.ts` only if the copy itself must change (say why first in your report; prefer not).

## Files readable

Everything. Key: `lorebooks/tableRegistry.ts`, `lorebooks/ownBook.ts`, `lorebooks/annex.ts`, `state/reading.ts`, `cast/memberAsRead.ts`, `pipelines/prompt/seatCards.ts`, `sessions/seatKeys.ts`, `sessions/seats.ts`, `messages/store.ts`, `state/resolve.ts` (`inForce`), `db/schema.ts`, `plans/REPORT-s4-bk-fold-2026-11-08.md` (the substrate and the five fold blockers, now ruled).

## Out of scope

The notes-member fold N → M′ and member overlays (`lorebook_bindings.overlay_of`) — worker 4 (leave a clearly named step to fill); the socket, buttons, clone removal, docs (worker 5); branching a folded session; where later writes land; NOMENCLATURE (queue rows).

## Rules you must follow (quoted)

- CLAUDE.md Hard rules: the `tx`-only rule above; "Never seed a row at a hardcoded id."; "It is a **session**, never a *chat*."
- P2 "A module owns its data and every write to it; peers use its contract … Two writers of one thing is a bug." — use the seats / messages / seat-keys writers named above, not raw updates of their tables, except where this brief allows.
- NOMENCLATURE R1 (code says *fold* because "merge" already means graph merge, the seat merge rule and `scenes:merge`; the UI says Merge), R3, R6 🚧 on every new exported name. New exported names allowed: `foldInParent`, `reseatOnto`, and the `restampSpeakers` export. Any other exported name → say so in the report.
- A refusal says what to do instead (the `FOLD_REFUSALS` sentences do).
- Comment style: plain present-tense sentences; no history comments ("previously", "used to", "was replaced") — a ratchet test fails on them.

## Commands

- Tests, capped and logged (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w3-tests.log'`
- tsc: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w3-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w3-tsc.log'` — other workers edit other files at the same time (the clone removal may briefly break `sockets/ownBooks.ts`); report errors in your files only.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Prettier: `npx prettier --check` on changed files; only `--write` lines you changed (your new files whole is fine).

## Report

Final message (no report file): changed files; `foldInParent` step list as built (one line each); what step 8/9 moved and what you judged not to name P (with the table names); the guard's projection (fields compared, fields dropped); tests run with counts; tsc for your files; deviations and why; **Noticed, not done**; NOMENCLATURE rows to queue (`foldInParent`, `reseatOnto`, the `restampSpeakers` export, the fold).
