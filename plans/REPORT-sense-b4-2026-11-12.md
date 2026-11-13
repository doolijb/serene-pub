# REPORT — build lane `sense-b4` — the flip (saved by the lead 2026-11-13; condensed from the supervisor's message)

All eight items built. No stop condition; no migration, schema change, setting, or published name or result shape
changed; `sdk:build` not run (the next SDK build carries the JSDoc). Seven workers.

## The rule as built

- **Who takes part:** a session that reads an attached lorebook and whose scenes end by themselves. Then a
  pipeline's new entry, place, history day or link goes to the session's own book, whatever the write setting, Full
  included: the same route as under Review, Off and on someone else's lorebook.
- The session reads those rows at once, notes first; nobody else does. A turn owns them (swipe, regenerate, Back,
  delete; Forward restores).
- They reach the lorebook only by Apply: by itself at scene close, when a waiting summary is saved, and at Close
  out, when the session's owner owns the lorebook and its write setting is Full; otherwise the owner's press.
- For such a session `sources` no longer moves the settle line; Apply does.
- **Branches:** a branch riding its parent's line gets its own line from its first Apply (pressed or automatic),
  inside the Apply; an Apply with nothing to apply forks nothing; a branch's changes reach its own line by
  themselves.
- **Ties and rules fields:** one whose entry or row lives in the own book is written there, on no line.
- **Everyone else writes exactly as before:** Chat, Story Minimal, a plugin genre with no scenes routine, a routine
  switched Off, scene mode Suggested or Manual.

**"Meets the rule"** is one exported function, `scenesEndByThemselves(db, sessionId)`
(`src/lib/server/lorebooks/ownBook.ts`): `sessions.lorebook_id` not null; `scenesRoutineOn` (an effective
`core:spec/scene-boundaries` registration not Off); `sessionSceneContext(…).settings.mode === "automatic"`;
`sessionSceneContext(…).mayPlace`. False on any error.

## Callers

`sessionLoreWriteTo` ← `create-lore-entry`, `update-lore-entry`, `link-lore-entries`: own book plus `alsoReads` when
the rule holds (the result carries `scenesEndByThemselves`); ← `writeLorebookAnnexDocument`: its own
`annexWriteBookOf`, the old book. `forkedLoreLine` / `pendingLineFork`: code unchanged, inert for sessions that
meet the rule. `loreWriteTargetFor` ← `rulesets/ties.ts routingOf`: `Routing.ownBookId`, an own-book entry or row
is an own-book landing; ← `state/durable.ts`, `characters/versions.ts`: untouched. `ensureSessionLine` ←
`applyOverlayItems` (new): inside Apply's transaction after the nothing-chosen return, then the line is read
again; not called by `ties.ts rowForSide` for an own-book row; its other callers untouched.

Still routed to the lorebook: every write of a session that does not meet the rule; stat values, timeline
captures, cast versions, the lorebook annex; a person's own press; scene compile.

## Where the later ruling won over the brief's letter

1. `writeThrough: true` stays (never reached by a session meeting the rule; it is what keeps other sessions'
   days written straight through). ★b4-4.
2. The `sources` settle is skipped only when `target.scenesEndByThemselves`. ★b4-3.
3. `forkedLoreLine` / `pendingLineFork` stay for the `book` route.
4. `update-lore-entry` resolves own book first only for sessions meeting the rule.

## Tests

Rewritten: `host.historyWrites`, `host.ownBookRoute`, `host.forkTiming`, `sessions.lairKnock` / `lairWalk` /
`lairFileRoom` (helpers read the lorebook plus the own book; new cases show a room and its links in the own book
until `closeScene`, then in the lorebook), `messages/loreLinks`, `state/sessionLoreWrites`, `lorebooks/imprints.int`
(kept/revert through the direct writer), `state/durable`, `state/locations`, `lorebooks/autoApply` (the branch
case, to the owner's ruling). New: `host.ownBookFull.int` (13), `host.scenesEndRoute.int` (10, real predicate:
Story Living true; Chat, routine Off, Suggested, Manual, Story Minimal unchanged; a room, link and day in the own
book, read by the session alone, taken by swipe and Back, restored by Forward, applied at `closeScene`; a member's
session holds), `lorebooks/applyForksLine.int` (6), `ties.int` additions, a dating pin in `sessionLoreWrites`.
Lane's runs: 15 files 235; b1–b3 suites 24 files 201; Lair 9 files 90; Dungeon Crawler 9 files 85; `tsc` clean.
Item 6's readers (places list, map, retrieval, keyword match, names list, place stat values) were read in code,
not all tested.

## Provisional copy 🚧 and names

Docs only: `docs/lorebooks.md` (eight passages on "a session whose scenes end by themselves"),
`docs/lorebook-time.md` (a session's line is made by its first Apply), SDK `guides/storage.md`, `INTEGRATING.md`
~1411, `contracts/src/outlets.ts` JSDoc; NOMENCLATURE own-book and held-amendment rows and a §25 section. Names:
`scenesEndByThemselves`, `annexWriteBookOf`, `Routing.ownBookId`.

## Open ★

- **★b4-1** automatic Apply runs for branches; with ★B1-6 an **undated** held change from a branch folds into the
  entry's base row, so the original and every line see it, now with nobody pressing.
- **★b4-2** (accepted, pinned) the dating of values, timeline captures and cast versions while a day waits.
- **★b4-3**, **★b4-4** as above.
- **★b4-5** a member's session that meets the rule never settles by `sources` and never applies by itself.
- **★b4-6** an Apply that forks and then holds every chosen item keeps the empty new line.
- **★b4-7** the Lair test helpers read both books for every case.
- **★b4-8** names and copy. Carried: ★B1-1, ★B1-3, ★B1-6, ★B1-7, ★b2-1…6, ★b3-2…10.

## Noticed, not done

- `docs/genre-lair.md` ~172, ~191, ~194 now false for a Lair session with Automatic scenes (a room waits in the
  session's notes until a scene closes).
- `update-lore-entry` re-dating a history entry checks the own book's calendar; `fileOntoHistoryDay` the lorebook's.
- `ties.ts` cast-state landings still skip a cast member living in the own book under Full.
- The predicate costs one cached `effectiveRegistrations` and one `sessionSceneContext` per lore write.

## Verification, scope review and fixes (lead, 2026-11-13)

Lead's run before the fixes: 120 files, 1,139 tests pass (the two reds were the lead's own new tests caught
mid-edit). The review found the build lane in its files (no setting, flag, event or migration; names recorded) and
raised five points, all fixed by the lead:

1. **A branch's automatic Apply duplicated its original's waiting rows in the lorebook.** A branch is made with a
   copy of its original's own book; after the flip the original's new rooms wait there, are copied, and both
   sessions applied them. `applyHeldAutomatically`: a branch offers only items anchored on its **own** messages
   (not on a copied line, `metadata.copyOf`, and not unanchored). Copies stay for a press. Test added.
2. **★b4-1 confirmed:** an undated held change from a branch folds into the entry's base row, which every line
   reads. A branch's automatic Apply now leaves undated held changes for a press; dated ones land on its line.
3. **A ruleset tie never followed its applied room** (Apply never moves a tie row; the next ruleset run found the
   notes' row and stopped). `rulesets/ties.ts rowForSide`: when the notes' row has entry ends that are all the
   lorebook's now and the session writes the lorebook, the tie is made on the lorebook and the notes' row removed.
   Test added.
4. **Docs now false for default play** corrected: `docs/pipelines.md` (the `sources` settle), `docs/summarization.md`
   (where a summary is written), `docs/genre-lair.md` (Write the room), the `sources` JSDoc in SDK
   `contracts/src/outlets.ts` (four places; the next SDK build carries it).
5. **The predicate answered false on any error**, which would send a write straight into the shared lorebook
   unseen. `scenesEndByThemselves` now throws ("Could not tell where session ‹id› keeps what it writes, so nothing
   was written."): the write fails where a person can see it.

After the fixes: `tsc` clean; 31 files, 284 tests pass.

Kept for the branch-cut build lane (Stage B "one cut at the fork message"): a branch still holds a **copy** of a
row its original has since applied, so it can read the room twice until one of them is dropped; entries are not
cut by session cuts. Also kept: the predicate is asked per write, not per run (a scene-mode change mid-run can
split one run's writes); an Apply that forks and then holds everything keeps an empty line (★b4-6); rows already
held when a session stops meeting the rule wait for a scene close, Close out or a press; under Full a tie between
two lorebook entries or cast members is still written to the lorebook and forks a branch's line; the Lair test
helper reads every session's own book on that lorebook.
