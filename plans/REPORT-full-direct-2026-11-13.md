# REPORT — build lane `full-direct` — under Full, a session writes straight into the player's own lorebook (2026-11-13)

Brief: `plans/briefs/BRIEF-full-direct.md` (its Corrections section rules). Worker briefs
`plans/briefs/BRIEF-full-direct-w1.md` … `-w4.md`; logs `plans/full-direct-*.log`. Owner (2026-11-13): "file it
right away. if review is off, write directly to the lorebook"; "Settle when a scene closes".

**Correction 1 was held on the lead's instruction** (the owner opened a discussion on what gets dated): a dated
session's change to an existing lorebook entry still waits in its notes and drains as a dated change at scene
close. No new imprint subject. No migration, schema change, setting, event or published name; no `sdk:build`; no
hash re-pinned. **Nothing was looked at in a running app.**

## The rule as built

| What the pipeline writes | Full, on the owner's own lorebook | Review changes / Off / a book someone else owns | Notes are the whole lorebook |
|---|---|---|---|
| New entry, place, history day, link | The lorebook, on the session's line, imprinted; whether or not scenes end by themselves | Notes, as before | Notes, as before |
| Change to an existing lorebook entry, undated session | Written into the entry, imprinted; name kept on a shown rewrite | Waits (held), as before | n/a |
| Change to an existing lorebook entry that still waits under Full | when the session is dated; when the entry is on another line or the line's fork is pending (a branch; never a refusal); when the session already holds a change on that entry | — | — |
| Change to an entry waiting in the notes | Changed there, imprinted on the notes | Same | Same |
| A filing tool's `toNotes` | Notes | Notes | Notes |
| A press with no turn (Lair **File as a room**) | Lorebook, no imprint: Back does not take it | Notes | Notes |

- The settle on a `sources` write is unchanged (still skipped for `scenesEndByThemselves`, which
  `sessionLoreWriteTo` now reports on every route).
- One internal helper decides the hold: `lorebookChangeHeld` (`host.ts`); `changeLoreEntry` calls it or takes an
  internal `held` value from the two outlets. Held answers `route: "own-book"`; in place answers `route: "book"`.
- On the "book" route the match in `create-lore-entry` and the `entry` resolve in `update-lore-entry` look in the
  notes first, then the lorebook. `loreMatch.ts` unchanged. Nothing removed; nothing became unreachable.

## Settling (correction 2)

`applyHeldAutomatically` (`ownBook.ts`) now settles the story on the "book" route at exactly the moments automatic
Apply runs, whether or not anything was applied, after every existing guard (a summary running or in review, a
rewound turn, a scene not closed, a book the session's owner does not own). Through the scene's end (Close out:
`before - 1`, or the newest message). Never past the message before a waiting summary's start, nor past the
message before the oldest item still waiting after the Apply. Own transaction, `settleThrough`; `settle.ts`
unchanged. `bookLoreWriteMode` is already the stricter of the person's and the book's setting
(`state/loreWriteMode.ts` ~45–53), so the brief's "mismatch" note did not apply.

## Branches; rows that wait

A branch's change to an entry on its original's line, or while its fork is pending, waits in the branch's notes
(the old refusal at `host.ts` ~2283 is a hold for a lorebook entry). A branch's new entries, places, days and
links go to the lorebook and fork its line on the first write. Automatic Apply is unchanged and drains waiting
rows. A name that meets a waiting notes row changes that row. A second change to an entry the session already
holds a change on is a second held row, applied in order at the next scene close.

## `imprints.ts` (corrections 3 and 5)

- `holds` widened: a made entry stays with a `kept` imprint (the *replaced* note) when any of these stand on it:
  any link touching it in any book; an entry filed under it; a line amendment or another session's held change;
  another session's message or notes annotation naming it; another session's place values (Take back's predicate).
  This session's own held change does not hold it (supervisor's addition, tested). Back on a session's own notes
  is unchanged.
- Forward: a made entry whose stored position is taken comes back at `nextPosition`.
- **Stopped, as briefed:** restoring a made history day while another day for the same date was written meanwhile
  succeeds and leaves **two days for one date** (one-per-date is enforced only in code, `assertHistoryDateFree`).
  A fix needs a merge; not built.

## Tests (supervisor)

Rewritten, none deleted or skipped: `host.heldEntryChange.int`, `host.loreMatchShown.int`,
`host.historyWrites.int`, `host.ownBookFull.int`, `host.ownBookRoute.int`, `host.scenesEndRoute.int`,
`host.forkTiming.int`, `loreSources.int`, `imprints.otherSessionLink.int`, `heldAmendments.exclusions.int`,
`imprints.int`, `autoApply.int`, `liveScenes.autoApply.int`, `heldApply.int`, `applyTakeBack.int`,
`heldAmendments.undo.int`, `sessionLoreWrites.int`, `loreLinks.int`, `sessions.lairFileRoom`, `sessions.lairKnock`,
`sessions.lairWalk`, `sessions.sweepShown`. Tests that used Full only to reach the held path now use Review
changes. New: `host.fullDirect.int` (the Build 6 cases except the plugin-provided book), `imprints.holds.int`
(11), `autoApply.settle.int` (9).

Final grouped run: 38 files, 467 passed, 1 failed (`commentHistory` ratchet on 9 files not this lane's).
Neighbours: `server/lorebooks` 33/33, `server/state` 56/56, Lair socket tests 9/9, `pipelines/runtime` 160/163,
`server/sessions` 86/87; the six failures (`allPipelines.int` speak dispatch, `guideGrounding.int`,
`scoreLedAllocation.int`, `sessions/genreFieldDefaults.int`) were not investigated and look unrelated. `tsc` 0
errors. `npm run check` not run (no `.svelte` change). `prettier --check` fails on `host.ts` as at HEAD.

## Changed files

Source: `src/lib/server/pipelines/runtime/host.ts`, `src/lib/server/lorebooks/imprints.ts` (`holds`, `insert`),
`src/lib/server/lorebooks/ownBook.ts` (`applyHeldAutomatically`). Tests as listed. Docs: `docs/lorebooks.md`,
`docs/lorebook-time.md`, `docs/genre-lair.md`, `docs/sessions.md`, `NOMENCLATURE.md` (rows; §25 *Full writes
straight into the lorebook*), `../serene-pub-sdk/guides/storage.md`, `../serene-pub-sdk/INTEGRATING.md`.

## SDK declaration texts that still state the old rule (not edited)

`../serene-pub-sdk/contracts/src/outlets.ts` ~1769, ~1862, ~1874, ~1911–1913, ~1946, ~1982–1987, ~2106, ~2125,
~2216.

## Open ★

- ★FD-1 A Full session with no scenes at all still settles on each routine `sources` write, as before.
- ★FD-2 On the "book" route a `link-lore-entries` end that is a room still waiting in the notes is refused
  ("not in this session's lorebook") until it drains at the next scene close.
- ★FD-3 The card sentence *The lorebook takes this session's changes by itself as each scene closes.* now reads
  as if every change waits. Possible: *The lorebook takes what waits here by itself as each scene closes.*
- ★FD-4 A scenes-end session with a pending line fork and no fork date is now refused a history day with the
  existing "…with no fork date…" sentence, as any Full session already is; before, its day went to the notes.
- ★FD-5 The scene-close settle never passes a waiting item: a branch's copied rows or an undated held change
  that waits for a press keep the line below them, possibly for good.
- ★FD-6 Forward can leave two history days for one date (above).
- ★FD-7 Correction 1 (a dated change written straight to the lorebook) is held for the owner's discussion.
- ★FD-8 `holds` also counts another session's annotations naming the entry (from Take back's checks).

## Noticed, not done

- `create-lore-entry` on the "book" route makes one extra `sessionLoreWriteTo(…, {notes:true})` call and a
  second `scenesEndByThemselves` evaluation per write.
- `update-lore-entry` computes `held` outside the book's lock (a small race with a concurrent held change).
- A `create-lore-entry` that matches a notes row and names `links` writes those links into the notes, with no
  history-day dating.
- `fileOntoHistoryDay` on the "book" route looks only in the lorebook: a day still waiting in the notes is not
  found and a second day is made in the lorebook.
- `scenesEndByThemselves` mocks in `imprints.int` and `loreLinks.int` no longer change routing; the header
  comment of `sessionLoreWrites.int` (~19–24) states the old rule.
- The plugin-provided-book case is covered only by the member's-session test (same route).

## Lead follow-up (2026-11-13)

Queued items done by the lead: `sockets/sessions.ts` `applyHeldAutomaticallyAndTell` now announces a scene-close
settle when nothing was applied (the card is told to move only when something was); `docs/pipelines.md` ~89 and
`docs/summarization.md` ~76 state the new rule. The SDK JSDoc waits for the next rebuild.

## Lead verification of the first lane (2026-11-13)

Capped run (`plans/full-direct-lead-1.log`): `server/lorebooks`, `server/state`, `server/scenes`,
`server/messages`, `server/sessions`, the `runtime/host.*`, `loreSources`, `loreMatch` tests, the Lair, sweep,
memory, apply-list and close-out socket tests, `entries.earmark`, `client/components/sessionForms`: 285 of 286
files, 2625 tests pass. The one failing file, `sessions/genreFieldDefaults.int` (Lair default keys), is not this
lane's. Scope review: in scope and correct as built; its findings were two writes now refused that the notes
used to take (★FD-2, ★FD-4), three doc sentences (fixed by the lead: `docs/pipelines.md` ~89,
`docs/genre-lair.md` ~172, ~191) and test hygiene. Those went to lane `full-direct-2`.

## Lane `full-direct-2` (2026-11-13) — brief `plans/briefs/BRIEF-full-direct-2.md`, its Corrections ruling

Owner: "And yes, need to fix the issues you just raised." Worker briefs `BRIEF-full-direct-2-w1.md`, `-w2.md`;
logs `plans/full-direct-2-*.log`. No migration, setting, event or published name; `ownBook.ts`, `imprints.ts`,
`scenes/historyEntryOfDate.ts`, `sessions/rewind.ts` untouched. **Nothing was looked at in a running app.**

All on the "book" route (Full, the owner's own lorebook). Four private helpers in `host.ts` beside
`ownBookDaysCounted`: `notesBesideBook` (the notes' id, anchor and an explicit notes line: `branchId` null,
`historyEntryId` from `ownBookDaysCounted(…).dating`, `alsoReads` the lorebook's reading; never creates the
notes), `notesRowAnswering`, `historyDateOf`, `historyDayInNotes`.

- **Build 1 (★FD-2).** `link-lore-entries`: when either end answers to **exactly one seen** notes row, the
  notes' lock is taken, nothing forks, and the link is written into the notes with the notes' history-day
  dating, imprinted and source-recorded there; both ends in the lorebook: unchanged. `create-lore-entry`'s
  `links`: a link whose other end is a notes row lands in the notes; a match forks only when one of its links
  lands in the lorebook. A name that answers to one notes row resolves to it even when the lorebook has that
  name too. Supervisor's decision: a tie in the notes, an unseen row or an id not in the notes falls through to
  today's lorebook lookup (the literal "resolve against the notes line" would have refused a write that
  succeeds today).
- **Build 2 (★FD-4).** For a session whose scenes end by themselves, decided before `forkedLoreLine`: when rule
  C would refuse the day on the line (fork pending with no fork date or the day on or before it; or a forked
  line where `historyDayOwnerRefusal` refuses), the day goes to the notes and nothing forks. Other Full sessions
  keep the refusal.
- **Build 3.** The outlet looks in the notes first for a waiting day of the date
  (`historyEntryOfDate(…, {create:false})`); it takes the paragraph. The default date counts the notes' days. A
  day the notes take reports `route: "own-book"`.
- **Build 4 dropped** (owner 2026-11-10 ★H3): Forward merges nothing. Test: Back, another day written for the
  date, Forward: both days keep their text and Loose ends lists one doubled date.
- **Build 5 (★FD-3).** The card says 🚧 *The lorebook takes what waits here by itself as each scene closes.*
- **Build 6.** `autoApply.int`'s `change()` uses the real outlet again (a dated session reaches the held path);
  the ~401 test renamed; the Apply record's automatic cause is still asserted in `autoApply.int`; new tests: a
  match naming `links` on a pending fork; Back and Forward on a session's own notes after `holds` widened.

Tests: new `runtime/host.notesMeet.int` (12); rewritten `host.ownBookFull.int` (a link from a waiting notes room
is kept in the notes), `host.historyWrites.int` (default date; the pending dateless fork writes to the notes).
Lane run 19 files: 18 files / 250 tests pass; the failure is the `commentHistory` ratchet on 9 files not this
lane's. `tsc` 0 errors; `npm run check` 0 errors, 8 warnings elsewhere.

Changed: `runtime/host.ts`, `sessionForms/SessionViewPanel.svelte` (one sentence), tests
(`host.notesMeet.int` new, `host.fullDirect.int`, `host.historyWrites.int`, `host.ownBookFull.int`,
`lorebooks/autoApply.int`, `lorebooks/imprints.holds.int`, `sessionViewPanel.applied.dom`), docs
`lorebooks.md`, `lorebook-time.md`, `genre-lair.md`.

Open ★: FD-3's sentence and the new doc sentences (🚧); a name in both books resolves to the notes row; a tie in
the notes falls through to the lorebook; the default history date counts the notes' days; FD-1, FD-5, FD-7,
FD-8 from the first lane. FD-6 settled by the 11-10 ruling.

Noticed, not done: **Apply's move path does not check rule C** (a scenes-end session's notes day for a date its
line does not own is moved at scene close as a new entry on the fork line when the line reads no lorebook day
for it; Loose ends would list it; needs `ownBook.ts`); a notes match's links stay unimprinted on a press-started
run; `notesRowAnswering` reads the notes before taking their lock; an *Exits:* line links only rooms the
lorebook has; fixtures without a notes row (`host.historyWrites.int`'s `world`) cannot see notes behaviour.

## Lead verification, scope review and follow-up of `full-direct-2` (2026-11-13)

- Lead's capped run (`plans/full-direct-lead-2.log`): `server/lorebooks`, `server/scenes`, `server/messages`,
  the `runtime/host.*`, `loreSources`, `loreMatch` tests, the Lair, sweep, memory, apply-list and close-out socket
  tests, `state/heldAmendments*`, `state/sessionLoreWrites`, `sessions/rewind*`, `client/components/sessionForms`:
  149 files, 1477 tests, all pass.
- Scope review: in scope (13 files, four module-private helpers, nothing exported), locks ordered lorebook then
  notes everywhere, other routes untouched. Findings:
  1. **Fixed.** The pending fork with a fork date was untested and `host.historyWrites.int` had lost its
     fork-riding case. Added (worker w3, `plans/briefs/BRIEF-full-direct-2-w3.md`): `host.notesMeet.int` "fork
     pending, the story clock at Year 4" (Year 3 and Year 4 days go to the notes, nothing forks; a Year 6 day
     forks and lands on the new line); `host.historyWrites.int` a forked scenes-end session's Year 6 day lands on
     its fork, one branch.
  2. **Fixed.** The Forward test now reads each day's date from its stored fields (before Back, after Forward,
     and for the Loose ends items).
  3. **Fixed.** `historyDayInNotes` no longer swallows every error: only a refusal (`BranchRefusal` or a plain
     `Error`) answers "ask the line as usual"; a database fault passes through.
  4. **Fixed.** 🚧 added to `docs/lorebooks.md` ~241 (two sentences) and `docs/lorebook-time.md` ~178.
  5. **Open ★FD-9.** Apply's move path has no rule-C check (`ownBook.ts` ~2028–2036; only the merge loop ~2051
     has it): a scenes-end branch session's notes day for a date its line does not own, when the lorebook holds
     no day for it, is moved at scene close onto the fork line as a day before the fork; Loose ends lists it.
     Older than both lanes. Lead's recommendation: the day waits with the rule-C reason, as on the merge path.
- After the follow-up: the three test files 55 of 55 pass (`plans/full-direct-2-w3.log`);
  `npx tsc --noEmit -p .` clean; `npm run check` was 0 errors at the lane's end (no Svelte file changed since).

## Found by the other session's full run, and the ruling that followed (2026-11-14)

Three files outside both lead runs failed after `full-direct`:
1. `sockets/sessions.retraction.int` pinned "held in the session's own book". **Rewritten** to the rule: the
   change is written into the entry, no held row, and a swipe restores the entry's own row.
2. `pipelines/routines/sceneSummaries.routine.int` (Back across a routine-saved scene was refused) and
3. `sockets/scenes.routineSummary.int` (a routine's save moved the settle line) showed **two owner rulings in
   conflict**: 2026-11-12 "a routine-saved summary never settles; Back resets it" and 2026-11-13 "Settle when a
   scene closes". The lead had told the owner "the player sees no change" when offering the second: wrong.
   Put to the owner with both quotes on 2026-11-14; ruled **"Settle one scene behind"**.

Built by the lead (`lorebooks/ownBook.ts` `applyHeldAutomatically`): on the book route, when a scene closes the
story settles through the message before that scene began; Close out is unchanged; Apply's own settle (through
the newest applied turn) is unchanged. Tests rewritten to it: `autoApply.settle.int` (two-scene fixtures; a
person's saved summary still settles its own scene), `autoApply.int` (two expectations),
`liveScenes.autoApply.int`, `scenes.routineSummary.int` (the line is the message before the scene). Run: those
plus `sceneSummaries.routine.int`, `sessions.retraction.int`, `host.scenesEndRoute.int`, `sessions.closeOut`:
8 files, 88 tests pass (`plans/full-direct-lead-4.log`, `-5.log`). Docs: `docs/lorebooks.md` ~254,
`docs/pipelines.md` ~89, SDK `guides/storage.md` ~61.

Open ★FD-10: Apply's own settle still runs through the newest applied turn, so in a session that keeps changes
waiting (a dated session, a branch) a scene close that applies something can settle into the scene that just
closed, where a routine-saved summary sits. Not changed. Lesson for the lead: the wider run after a routing or
settle change must include `sockets/scenes.*`, `sockets/sessions.*` and `pipelines/routines`.
