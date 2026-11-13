# BRIEF cv-core-w3 — the `character-versions` boot pass: lift cards, cast members and amendments; fill the seater

Worker (Sonnet) for lane **cv-core**; the supervisor is the cv-core lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-core-w3 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
Plan §32 §8 and §33.4/§33.5: a boot pass that moves every install onto character versions — every card gets **v1**, every cast member a **base** version, every cast amendment becomes complete versions where today's read needs one, verified against today's read at every (line, breakpoint, life-point tier); what still reads differently is **lifted anyway** with a note on the member's base and a count; and every character seat's `seated_by_user_id` is filled from the held card's owner.

Another worker is adding the session write to `src/lib/server/characters/versions.ts` at the same time. **Do not edit `versions.ts`**; import from it.

## Files owned (edit only these)
- `src/lib/server/characters/versionsLift.ts` (new) — the pass.
- `src/lib/server/characters/versionsLift.int.test.ts` (new), `src/lib/server/characters/versionsLift.test.ts` (new, pure, if you have pure helpers worth testing).
- `src/lib/server/startup/index.ts` — ONLY the new task's registration, between `seat-members` and `plugins`.

Not `NOMENCLATURE.md`, not `versions.ts`, not `memberAsRead.ts`, not `profile.ts`. Nothing else.

## Files readable (and what to use from them)
- `src/lib/server/characters/versions.ts`: `ensureCardVersion(tx, cardId)` (v1 for a card, idempotent, `writtenBy: "lift"`), `memberProfileOf(member, cardProfile | null)` → `{ own, follows, mixedGreetings }` (**the one conversion** — use it for the base and for every lifted version), `insertCharacterVersions(tx, rows)` (**the one INSERT**; it draws ids and write orders — insert in the order you want the write orders), `cardProfileOf`.
- `src/lib/shared/characters/profile.ts`: `profileOf`, `mergeGreetings`, `profileDifferences`, `CharacterProfileField`.
- `src/lib/server/cast/memberAsRead.ts`: **today's read** `layerMemberAsRead(member: MemberRowForReading, card: CardRowForReading | null, sets, tags)` and **the new read** `layerVersionAsRead(member, version, parent, maxCardNumber, sets, tags)`. Both pure. (`asRowForReading` there is private; build `MemberRowForReading` yourself the same way.)
- `src/lib/shared/lorebooks/lineReading.ts`: `lineOf(branchId, branches)`, `MAIN_LINE`, `amendmentsOnLine(amendments, line, moment)` (main first, then each step outward, inside a step by date then id), `versionInForce(rows, line, moment, appearance)`.
- `src/lib/shared/lorebooks/amendments.ts`: `castAsOf(member, amendments, at)`, `amendmentsForAppearance(amendments, personalPosition)`.
- `src/lib/server/sockets/amendments.ts` ~226–315 `cardMemberAt`: how today reads a member at an appearance (`castAsOf(member, amendmentsForAppearance(amendments, p), at)`); `cast_presences` give the appearances' personal positions.
- `src/lib/server/sessions/seatMembers.ts` and `seatMembers.int.test.ts`: **the model for this pass** — the fast no-op query, one transaction per unit, failures counted and logged and the pass going on, one error thrown at the end so `failsHealth` reports it, and the test shape (60 s timeouts, a chosen unit failing).
- `src/lib/server/startup/index.ts` ~255–300 (the `seat-members` task to copy).
- `src/lib/server/db/schema.ts`: `characterVersions` ~9345–9570, `castAmendments` ~9246–9340 (`year` NOT NULL, `fields` partial: `name`, `aliases`, `summary`, `nodeState`, `nodeVisibility`, `spriteSet`, `characterId`, the retold columns and `retold`), `castPresences` ~9180–9245, `lorebookBranches` ~8996, `sessionCharacters` ~3950–4000 (`seatedByUserId`; an envoy seat has `envoy_slug` and no `character_id`).
- The attic tests (`src/lib/server/attic/upgrade.tiny.int.test.ts` and its helpers) for "attic upgrade, then boot".

## Rules you work under (quoted)
- Plan §32 §8: "The boot pass `character-versions` runs after `seat-members` (startup/index.ts:278) and before `plugins` (:292) … It is `failsHealth`, runs one transaction per book and per card set, uses `tx` only, and has a fast no-op." CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "**Cards** get v1. **Members** get a base: retold-ON fields own, the rest `follows`." "**Amendments** are lifted per line, parents first, in amendment-id order, which keeps `write_order` matching `byDateThenId`." "**Breakpoints.** The breakpoints are each amendment date on the chain within its cuts. The **tiers** are: below every life point, each amendment life point, each presence position, and null." "**Verify.** For each (line, breakpoint, tier) from the lowest tier up, compare today's fold (`castAsOf` over `amendmentsForAppearance(amendmentsOnLine(…))`) with the pick. Where they differ, insert a version on that line, at that date, with that tier's life point." "**Lift anyway.** Any mismatch left … is lifted anyway. The pass writes a `note` on the member's base listing line, date, appearance and fields, and adds to a count." "**Idempotence.** A member with a base, or a card with v1, is skipped."
- Owner (2026-11-05 late), mixed greetings: "Own list, noted": "the member gets its own full list (its retold opener + the card's current others), listed in the upgrade note and count".
- Owner (2026-11-05 late), acting rights: "The person who seated it"; §33.4: `seated_by_user_id` "filled by the boot pass from the held card's owner — today's rule — so nothing changes for existing seats".
- Lead heads-up: date-first picking (★CV-1) means a branch amendment dated before a later main amendment reads differently once lifted; the verify step handles it by inserting a version on the branch at the later date (a nearer line step outranks main on a date tie). Only what that cannot express is noted.
- CLAUDE.md "0.6 is in users' hands": "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." "Never seed a row at a hardcoded id."
- The module must not statically import `$lib/server/db`; it takes `db` as its first parameter, like `seatMembers(db)`. The startup task passes `db` (`await import` the module there, as `seat-members` does).
- Int tests that open a DB inside a test: **60 s timeout**; never pipe vitest into `head`; targeted tests only; `tsc` clean and prettier clean on your files (on `startup/index.ts`, only your hunk).
- Names: export only **`liftCharacterVersions(db)`** and its report type **`CharacterVersionsLiftReport`**. Private helpers are fine. Need another export → stop and say so.

## What to build — `versionsLift.ts`

Header: what the pass does, the rules quoted above, and "⏳ lives until the S5 drop (the drop's `before` hook runs the lift core when this pass never ran)".

`liftCharacterVersions(db): Promise<CharacterVersionsLiftReport>` with `{ cards: number; members: number; versions: number; noted: number; seats: number; failed: number }` — cards given v1, members given a base, versions lifted from amendments (beyond bases), members noted, seats given their seater, units that failed.

1. **Fast no-op** — ONE query answering whether any of: a `characters` row with no `character_versions` row; a `lorebook_bindings` row with `overlay_of IS NULL` and no `character_versions` row; a `session_characters` row with `seated_by_user_id IS NULL`, `character_id IS NOT NULL` whose card exists. None → all zeros, nothing else read. (Overlay rows never get a base — they hold only a session's writes.)
2. **Cards**, one transaction per owner (`characters.user_id`, "the card set"): `ensureCardVersion(tx, id)` for each card with no version.
3. **Books**, one transaction per book holding a member to lift: take the book's lock first (`select pg_advisory_xact_lock(<lorebookId>)` — the book's write lock), then read the members with no version (overlay rows excluded), all their `cast_amendments` and `cast_presences`, and the book's branches; build every line: `MAIN_LINE` and `lineOf(b.id, branches)` for each branch, **parents first** (a branch after the branch it forks from).
   For each member:
   - **Base**: `memberProfileOf(row, linkedCard ? profileOf(cardVersion) : null)` with `cardVersion = ensureCardVersion(tx, row.characterId)` (null when the card is gone); insert it: no branch, no date, no source, `personalPosition: null`, `parentVersionId` = the card version's id, `nodeState`/`nodeVisibility` from the row, `writtenBy: "lift"`. `mixedGreetings` → a note line.
   - **Amendments → versions, with verify.** For each line L (parents first), the breakpoints = the distinct dates of `amendmentsOnLine(theMembersAmendments, L, null)`, ascending by `compareDates`. The tiers = `[below, ...each distinct personal position of the member's amendments and presences ascending, null]` where `below` = (the lowest of those positions) − 1, and there is no `below` when there are no positions (then just `[null]`). For each breakpoint D, for each tier t, lowest first:
     - **old** = today's read: `folded = castAsOf(row, amendmentsForAppearance(amendmentsOnLine(list, L, D), t), { line: L, moment: D })`; `layerMemberAsRead(asMemberRow(folded), cardRow(folded.characterId), { member: [], card: [] }, [])` where `cardRow` is the `characters` row of the folded `characterId` (null when none or gone) as `CardRowForReading`.
     - **new** = `versionInForce(liftedSoFar, L, D, t)` layered with `layerVersionAsRead(row, version, parent, maxNumber, { member: [], card: [] }, [])` — `liftedSoFar` are the member's rows inserted so far (as returned by `insertCharacterVersions`, so they carry ids and write orders).
     - **compare** on: `name`, `nickname`, `aliases`, `summary`, `description`, `personality`, `scenario`, the greetings as ONE list (old: `mergeGreetings(old.firstMessage, old.alternateGreetings, old.groupOnlyGreetings)`; new: `new.greetings`), `exampleDialogues`, `faceMediaId`, `timbre`, `activeCardId`, `spriteSet`, and `nodeState`/`nodeVisibility` (old: the folded row's; new: the version's). Compare by stable JSON (object keys sorted).
     - **differ** → insert one version: `castMemberId`, `lorebookId`, `branchId` = L's own branch (null for main), the date D, `historyEntryId` and `liftedFromAmendmentId` from the latest amendment applied in the fold (by apply order), `personalPosition` = t for a numeric tier, **null for `below`**, and **the highest position for the null tier** (null when there are none) — so a session read (every life point) picks it on a date tie; profile + follows from `memberProfileOf(folded, card ? profileOf(cardVersion of folded.characterId) : null)`, `parentVersionId` that card version's id; `nodeState`/`nodeVisibility` from the folded row; `writtenBy: "lift"`; no source. Recompute **new**; still different → a note line for (L, D, t) and the differing fields.
   - At the head (moment null) and before the first breakpoint (the base alone vs the row with no amendments applied), verify too; a difference there is a note line (no insert).
   - **Note** (🚧 copy, proposed — the supervisor will mark it ★ for the owner): when any note line exists, set the base's `note` to `"Lifted from the old cast changes; these still read differently:\n"` + one line per difference: `"<line name, or main> · <Y/M/D, or the head> · <appearance N, or every appearance> · <field, field>"`, and the mixed-greetings line `"Greetings: one half was retold, so the retold half and the card's others became the member's own list (Follow the card's greetings undoes it)."`. Count the member in `noted`.
   - Amendments of a member are never deleted or changed.
4. **Seats**: one `UPDATE session_characters SET seated_by_user_id = characters.user_id FROM characters WHERE …` for character seats with no seater and a card; count rows.
5. A unit (a card set or a book) that throws: roll it back (its transaction), `failed++`, `console.error` with its id, go on. At the end, `failed > 0` → throw one error naming the count (as `seatMembers` does).
6. Log nothing itself; the startup task logs one line when anything was done: `[character-versions] <cards> card(s) given v1, <members> cast member(s) lifted (<versions> dated version(s)), <noted> read differently since the upgrade (noted), <seats> seat(s) given their seater` (and `failed` in the thrown error).

## Tests — `versionsLift.int.test.ts` (real DB; 60 s per test)
- **Second boot no-op**: run twice; the second report is all zeros and the fast path reads one query (spy as `seatMembers.int.test.ts` does, or count `db.execute`/`select` calls).
- **Overlapping ids**: a card and a member whose ids are equal (and a member whose id equals another card's id) — each lifted onto the right owner.
- **Every retold / amendment shape**: retold text fields on and off; an amendment turning a flag **on** and one turning it **off** later; own name / own nickname `""`; face retold with and without a face id; member timbre; a **dated card** (an amendment's `characterId` → the version's parent is that card's v1); a deleted (hard) card → card-less; nodeState `deceased` at a date. For each: after the lift, `membersAsRead` (the real reader) at several moments equals today's read at the same moments (compute today's with `layerMemberAsRead` + `castAsOf` before lifting, or compare to hand-worked values).
- **34 vs 50**: a member with presences at 34 and 50 and world-dated plus personally-dated amendments between them; after the lift, each appearance (`membersAsRead(…, { appearance })`) and the session read (null) equal today's (`cardMemberAt`'s per-appearance read).
- **Branch chains with cuts**: main + a branch forked at a date + a branch of that branch; main amendments before and after the fork; a branch amendment dated before a later main one (the ★CV-1 case) — after the lift every line reads as today, and the noted count is as you expect (say what it is and why).
- **Mixed greetings**: each half retold alone → own list as specified, noted and counted.
- **Seats**: a character seat with no seater gets the card owner; an envoy seat and a seat whose card is gone are left; second run changes nothing.
- **Failure isolation**: one book failing (mock as `seatMembers.int.test.ts` does) rolls back alone; the pass throws at the end naming the count.
- **Attic upgrade, then boot**: run the tiny attic upgrade (reuse its fixture/helpers), then `liftCharacterVersions`; every card has v1, every member a base, nothing failed. If the attic harness is too heavy to reuse, say so and stop that one test — don't build a new harness.

## Out of scope
`versions.ts` (read only), the reader, the session write, the admin screen that shows the count (wave 3), the S5 drop, NOMENCLATURE, docs.

## Stop and ask (in your report) when
An export beyond this brief seems needed; `versions.ts` / `memberAsRead.ts` / `profile.ts` lack something or disagree with today's read in a way the lift can't express (report the case, with the fields — don't patch those files); anything needs a file you don't own.

## Done means
```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/characters/versionsLift.int.test.ts src/lib/server/characters/versionsLift.test.ts src/lib/server/sessions/seatMembers.int.test.ts
```
green (never pipe into `head`); `npx tsc --noEmit -p . 2>&1 | grep -E "versionsLift|startup/index"` empty; prettier clean on your new files. Before and after the run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null` — delete by name only dirs that appeared from your runs.

Report: names and signatures, changed files, test results (counts per file), the noted cases you found and why, anything you disagreed with, Noticed-not-done.
