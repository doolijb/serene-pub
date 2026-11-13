# BRIEF — build lane `sense-b4`, worker 1 — the route in `host.ts`, ruleset ties follow the row

You are a `lane-worker`. Supervisor: build lane `sense-b4` (`plans/briefs/BRIEF-sense-b4.md`, which you may read
for context; this brief is your contract and wins where they differ). Words: a **build lane** is this stream of
work; a **channel** is a session's message channel. Never write bare "lane" for a channel.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Make the lore write route in `src/lib/server/pipelines/runtime/host.ts` follow one rule, and make ruleset ties
and rules fields in `src/lib/server/rulesets/ties.ts` follow the row they belong to.

**The rule (owner-ruled, binding):** for a session that reads an attached lorebook **and whose scenes end by
themselves**, a **pipeline's** write of a new entry, a place, a history day or a link goes to the session's own
book **whatever the lorebook's write setting** (Full included), exactly as it already does today under Review, Off
and on someone else's lorebook. It reaches the lorebook only by Apply (not your work). **Every other session writes
exactly as before** — Chat's notes, a plugin genre with no scenes routine, a session whose routine is Off or whose
scene mode is not Automatic still write straight to the lorebook under Full. Owner, on an earlier over-built draft:
"You're over complicating it" — take the plainer shape.

The predicate already exists (the supervisor wrote it): `scenesEndByThemselves(db, sessionId)` exported from
`src/lib/server/lorebooks/ownBook.ts` (right after `loreWriteTargetFor`). It reads: the session has an attached
lorebook; `scenesRoutineOn`; `sessionSceneContext(…).settings.mode === "automatic"` and `.mayPlace`. **Do not edit
`ownBook.ts`** — another worker owns it right now. Import the predicate dynamically as host.ts imports the rest of
`ownBook.ts` (`await import("$lib/server/lorebooks/ownBook")`).

## Every caller, found by the supervisor (re-read each before you change anything)

| Caller | Line (approx.) | One of this build lane's four kinds? | What it does after your change |
|---|---|---|---|
| `host.ts` `sessionLoreWriteTo` ← `create-lore-entry` | ~11493 | yes (entries, places, history days via `fileOntoHistoryDay`, links written with the entry, Exits links) | own book + `alsoReads` when the predicate holds |
| `sessionLoreWriteTo` ← `update-lore-entry` | ~11779, ~11815 | yes | same; resolves its entry own book first when the predicate holds |
| `sessionLoreWriteTo` ← `link-lore-entries` | ~11981 | yes | same |
| `sessionLoreWriteTo` ← `writeLorebookAnnexDocument` | ~2817 | **no** (lorebook annex) | gets its own small function, unchanged behaviour |
| `forkedLoreLine` ← create ~11550, link ~11996 | | yes | unchanged code; for a session meeting the rule the route is `own-book`, so it forks nothing |
| `pendingLineFork` ← `changeLoreEntry` | ~2250 | yes | unchanged code; inert for those sessions (the write's `lorebookId` is the own book, never `sessions.lorebook_id`) |
| `loreWriteTargetFor` ← `rulesets/ties.ts` `routingOf` | ~247 | ties/rules fields | item C below (follow the row) |
| `loreWriteTargetFor` ← `state/durable.ts` ~198 (timeline) · `characters/versions.ts` ~1865 (cast versions) | | no | **not touched** (out of scope) |
| `ensureSessionLine` ← `state/durable.ts` ~310, `state/write.ts` ~449/454 (values), `sockets/entries.ts` ~821 (a person's press), `sockets/scenes.ts` ~1148 (scene compile), `rulesets/ties.ts` ~434, `ownBook.ts` ~412 | | only ties is touched (item C) | **others not touched** |

## Build

### A. `sessionLoreWriteTo` (host.ts ~1616)

1. Read the predicate once per call. When it holds, the target is the own-book target (as the `opts.notes` branch
   builds it today: `ownBookFor`, `turnAnchorOf`) **whether or not `opts.notes` is set**, so the `book` branch is
   never taken for that session.
2. When it holds, the `{ notes: true }` distinction goes: a filing-tool write gets `alsoReads` and
   `ownBookDaysCounted` dating like every other write on the route (today line ~1665 withholds it for
   `opts.notes`). When it does not hold, `opts.notes` behaves exactly as today.
3. Add one field to the returned object: `scenesEndByThemselves: boolean` (false on the `book` branch). It is
   host-internal (🚧 provisional; list it in your report).
4. Update the JSDoc of `sessionLoreWriteTo`, `forkedLoreLine`, `pendingLineFork` and the `writeThrough` comments
   (~2231, ~2448) so they say what is true now (one or two sentences each; mark 🚧).

### B. The call sites

1. **Settle by `sources` goes for these sessions only.** At `create-lore-entry` (~11700), `update-lore-entry`
   (~11890) and `link-lore-entries` (~12037), `recordLoreSources` stays exactly as it is (provenance); the
   `settleThrough(...)` beside it runs only when `!target.scenesEndByThemselves` (for `update-lore-entry`, use the
   target from ~11779). Every other settle trigger is untouched. Do not change `announceSettled`.
2. **`update-lore-entry` resolves own book first when the predicate holds**: pass `readEntries` undefined and
   `then = target.line.alsoReads` to `resolveLoreLinkEnd` in that case (own book read first, the lorebook as the
   session reads it after — the rule the rest of the route uses, see the JSDoc at ~1404–1418). When the predicate
   does not hold, the call is exactly as today. `landing` (~1812) needs no change for such a session (its route is
   `own-book`, so `landing = target` or the held branch).
3. **History days:** `writeThrough: true` on `fileOntoHistoryDay`'s `changeLoreEntry` call stays. Reason (say it in
   your report): for a session meeting the rule the day is always the own book's (`historyEntryOfDate` is called
   with the own book), so the escape is never reached there; for every other session it is what keeps their
   history days written straight to the lorebook as before. Only the comment changes.
4. **The lorebook annex** (`writeLorebookAnnexDocument` ~2817): replace the `sessionLoreWriteTo(...).lorebookId`
   call with a small module-level function of its own (e.g. `annexWriteBookOf(db, sessionId, anchorMessageId)`,
   🚧) that returns `(await loreWriteTargetFor(db, sessionId, { anchorMessageId, fork: false })).lorebookId` —
   byte-for-byte today's book. **Not a flag on the shared function.**
5. Full's sentence `Both ends of a link live in one book.` (~1461) needs no code change: a session meeting the rule
   always carries `alsoReads`, which takes the other sentence. The sentence stays for every other session.

### C. `rulesets/ties.ts` — "an entry that lives in the session's own book is an own-book landing"

Today under Full a tie or a rules field for a room the run just made in the own book would be skipped ("this
session does not write the lorebook the place is in"), or written into the lorebook with one end in the own book,
forking a branch's line early. Change only that:

1. `Routing` gains the session's own book id (`lorebooksReadBy(...).ownBookId`, already read in `routingOf`).
2. **Held thing** (~880–902) and **place field** (~1084–1107): an entry whose `lorebookId` is the session's own
   book is written directly (the existing `writeColumn` branch), whatever `r.target.route` says. Nothing else in
   those chains changes.
3. **Tie row** (`rowForSide`, ~343–462): a found row that lives in the own book is the session's own (returned as
   found, never overlaid); a row it must make, when either end is an entry of the own book, is inserted into the
   own book with `branchId` null and **no** `ensureSessionLine` call; its imprint names the own book. Every other
   case is exactly as today.
4. Update the module JSDoc at ~28–34 in one sentence (🚧).

## Tests (yours to write and run)

Run only these files, only inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.

How to make a session meet the rule in a test that does not bootstrap pipelines: a partial mock of the predicate
with a per-session switch, e.g.

```ts
const scenesEnd = new Set<number>()
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()),
	scenesEndByThemselves: async (_db: unknown, sessionId: number) => scenesEnd.has(sessionId)
}))
```

(The real predicate is tested end to end by a later worker in a bootstrapped world; you need not.) Confirm the
mock actually reaches host.ts's dynamic import (a case that fails without it).

1. `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts` — **rewritten, never weakened**: every case
   that pins a history write straight to the lorebook under Full stays, labelled as a session whose scenes do not
   end by themselves; add, for a session meeting the rule under Full on its own lorebook: a history write files onto
   the **own book's** day (one row per date, two writes one row), nothing is written to the lorebook, no line forks,
   and the default date counts own-book days.
2. `src/lib/server/pipelines/runtime/host.ownBookRoute.int.test.ts` — section "9 · Full": the case asserting
   `Both ends of a link live in one book.` stays for a session that does not meet the rule (say so in its title);
   add the twin for a session meeting the rule under Full: the cross-book link is written to the own book (both
   ends resolved over both books), or an id in neither book gets the own-book route's sentence. Every other case in
   the file passes **unchanged**.
3. A new file `src/lib/server/pipelines/runtime/host.ownBookFull.int.test.ts` (same harness style as
   `host.ownBookRoute.int.test.ts`, mocked predicate) proving, under Full on your own lorebook for a session
   meeting the rule: `create-lore-entry` of a place lands in the own book (`route: "own-book"`, `lorebookId` the
   own book) with no line fork; with `sources` it records `lore_sources` and **does not** move the settle line;
   `update-lore-entry` of an own-book entry writes it in place and resolves a name both books hold to the own
   book's entry; a `toNotes` write gets the two-book reading; `link-lore-entries` between an own-book room and a
   lorebook room is stored in the own book; and the **same calls for a session that does not meet the rule write to
   the lorebook exactly as before** (route `book`, settle line moves with `sources`). Also: a lorebook annex write
   lands where it did before for both kinds of session.
4. `src/lib/server/rulesets/ties.int.test.ts` — add one `describe` (do not change existing cases): under Full on
   your own lorebook, a room entry that lives in the session's own book gets its rules field (place field) and a tie
   to another own-book room, **both in the own book**, nothing written to the lorebook, and a branch session riding
   its parent's line (`line_on_first_write` true) is **not** forked by it. Use the file's existing fixtures.
5. Also run unchanged, to show they still pass: `host.heldEntryChange.int.test.ts`,
   `src/lib/server/state/ownBookRoute.undo.int.test.ts`, `src/lib/server/sessions/branch.ownBookRoute.int.test.ts`.

Typecheck at the end: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report only errors in your
files; others are other sessions'. `npx prettier --check <file>` on each file you changed.

## Files owned (edit only these)

`src/lib/server/pipelines/runtime/host.ts` (the lore write path only), `src/lib/server/rulesets/ties.ts`, the test
files named above (the new one included).

## Files readable

Anything. In particular `ownBook.ts`, `state/reading.ts`, `scenes/boundaryWatcher.ts` (`scenesRoutineOn`),
`sessions/sceneSettings.ts`, `sessions/settle.ts`, `lorebooks/imprints.ts`, `plans/REPORT-sense-b3-2026-11-12.md`.

## Out of scope (written down, never built)

`ownBook.ts` (another worker), Apply, automatic Apply; the write mode, its columns, readers and UI; cast members
and versions; stat values, `recordToTimeline`, `state/write.ts`, `state/durable.ts`; scenes and summaries
(`sockets/scenes.ts`, `scenes/`); a person's own press (`sockets/entries.ts`); retiring `loreWriteRoute` /
`loreWriteTargetFor` / `ensureSessionLine`; docs and NOMENCLATURE (the supervisor's); any migration, schema change,
setting, new settle trigger, published SDK name or result **shape** (a result's `route`/`lorebookId` **values**
now name the own book for these sessions — that is expected). How a pipeline chooses to update an entry or add a
child instead of duplicating is a later build lane.

## Stop and ask (in your report, then stop) when

A migration or schema change seems needed; a published SDK name, port or result shape would change; a test you
were told passes unchanged fails because of your change and the fix is not inside your files; a ruleset tie or
rules field for an own-book row cannot follow it with item C's change; anything needs a new user-facing sentence
(say the sentence you would propose, do not add it).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — and in this build lane: **do not run `npm run sdk:build` at all.**
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently). Never
  run npm at the SDK repo root. It is a **session**, never a *chat* (the genre named Chat is a name). Every session
  has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything**; line numbers are approximate (another build lane edited
  host.ts earlier today).
- Other sessions are editing this repo (a visual-novel layout build lane, speech): never touch their files, never
  "fix" failures that are theirs.

## Report (your final message)

Changed files; for each change, one line on what it does; the exact shape of `scenesEndByThemselves` on the
return and the annex function's name; every test file run with pass/fail counts; anything that failed and why;
new internal names (🚧); open questions; **Noticed, not done**.
