# BRIEF — lane `sense-age2` — stamp the session's story clock on stat values, then hand scripts the time since

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then, in full,
`plans/briefs/BRIEF-sense-age.md` (the first lane's brief: every goal there that was not built is yours, and its
**Verbatim rules** bind you and your workers word for word) and `plans/REPORT-sense-age-2026-11-11.md` (what was
built, why derivation failed, ★A). Then plan §2.12 in `plans/PLAN-sensible-engine-2026-11-11.md`, CLAUDE.md **Hard
rules** (migrations) and the "0.6 is in users' hands" ruling.

## The owner's ruling (2026-11-11, verbatim)

Asked whether to stamp story time on each stat value with five nullable columns and one migration:
"That's fine. I think we are okay just tracking stat time relative to the session."

**Read as:** ★A1 is a go. The stamp is the **session's** story clock at the moment a session writes the value.
A value no session wrote (a starter kit, a dowry, a plugin's provided book, a lorebook editor write, a ruleset
conversion) carries no stamp and reads null. Nothing is placed on a book-wide timeline.

## Goal

1. **The columns.** Five nullable `story_clock_*` columns on `attribute_values`, the same shape and names
   `session_messages` and `scenes` carry (read those first; reuse their column helper if one exists). Schema edit,
   then `npm run db:generate`. **The new migration's index must exceed the highest applied (0153 today; re-check
   `drizzle/` and `drizzle/meta/_journal.json` immediately before generating, because another session is building
   and may have added one).** Never hand-write or renumber. Old rows read null: no backfill, no boot pass. Add the
   test that a second boot changes nothing if the existing migration tests do not already cover a nullable add.
2. **The write.** `setValue` (and any other path through which a *session* writes a value) stamps from
   `sessionStoryNowOf`, inside the transaction it already runs in (`tx` only). No clock means null.
3. **The copies.** Every path that copies a value row carries the stamp unchanged: branch, rewind, retract and
   restore, apply. The non-session insert sites the report lists leave it null; confirm each one and say so.
4. **The fact, the real seconds and the sleep test.** Build goals 2, 3b, 4 and 5 of the first brief on the stamp:
   minutes are the calendar's arithmetic between the stamp and the session's clock now; writing the value brings it
   to 0; a re-run with no time passed gives the same number (the idempotence the derivation could not give). Choose
   the envelope key by NOMENCLATURE §24 (`since` is taken: the report says where) and record it in §25.
5. **Say it where authors read**: goal 6 of the first brief, plus the SDK storage guide's stat row if it lists
   columns.

## Files owned

`src/lib/server/db/schema.ts` (the five columns only), the one generated migration and its journal entry,
`src/lib/server/state/write.ts` and the copy paths named in goal 3 (the stamp only), and everything the first brief
owned. In `../serene-pub-sdk/`: the envelope type, the functions guide, the storage guide row, tests and pins these
move.

## Out of scope

A backfill; a stamp on any other table; the open ★B, ★C, ★D of the first report; a shipped sleep ruleset; UI.

## Stop and ask when

The migration would need anything but five nullable columns; a published name would change or be removed; a copy
path cannot carry the stamp without reshaping what it copies.

## Done means

The first brief's **Done means** lines for the envelope, the sleep body, Back, no-clock and real seconds all pass;
a branch and a rewind keep the stamp; a non-session write reads null; `npx tsc --noEmit -p .` with
`NODE_OPTIONS=--max-old-space-size=10240` is clean apart from one known error at
`src/lib/client/components/sessionPage/requests/index.ts:380` (`show-line`, another session's work: do not touch it).
`npm run sdk:build` once at the end if the SDK changed, after the `pgrep` check; then run
`../serene-pub-sdk/sdk-tests/coreCatalog.test.ts` and report any pin that moved instead of re-pinning silently.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-age2-2026-11-11.md`):
the migration's name and index, the key you chose, each copy path and insert site with what it does, changed files
in each repo, tests and results, open ★, **Noticed, not done**.
