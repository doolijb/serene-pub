# Lane s4-follow-c: starting on your own surfaced book, and the seat-changes read (2026-11-09)

Both goals are built and every targeted test passes. No migration, no new column, no stored-data change, and no core genre's behaviour changes.

- **sdk:build:** not needed and not run.
- **SDK tests:** `sdk-tests` resolves `@serene-pub/sdk` to `../sdk/src` through its tsconfig `paths`, so the targeted ones ran against source without the build; `dist/` is untouched.
- **Worker briefs:** `plans/briefs/BRIEF-s4-follow-c-w1.md` and `-w2.md`.
- **Logs:** `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-follow-c-*`.

## Goal 1: your own surfaced book starts on the book; a shared one is copy-only

Owner, 2026-11-09: "Own: start on; shared: copy".

**Server**
- `src/lib/server/lorebooks/ownBook.ts`: `surfacedBookRefusal(db, { lorebookId, creationMode, userId })` now returns null when the asker owns the book. The JSDoc gives the new rule.
- `src/lib/server/sockets/sessions.ts`, `sessions:create` only:
  - It passes `userId` to the refusal.
  - It takes `lineOnFirstWrite` off `params.session` by name, so the bare spread can no longer write it.
  - It writes `lineOnFirstWrite: true` only when all of these hold: it was sent true, the mode is `new`, there is no starter kit, and the session reads a book the asker owns directly. The owner is read before the transaction.
  - Any other case refuses with `refuse(…)` and the sentence in ★c-2.
- **Continue the latest line** is the existing default: no line named → `mostRecentBranchOf`.
- **Branch off at a point** is line + clock + `lineOnFirstWrite`. The existing `ensureSessionLine` forks a new line at the session's date on its first write to the book. No second reading rule.

**Client**
- In `src/lib/client/components/sessionForms/StartSessionForm.svelte`, own surfaced books are ordinary rows again, in both layouts.
- When you pick one in `new` mode, a **How it starts** radio list opens under it: **Continue the latest line** or **Branch off at a point**.
- Branch off reuses `SessionLorebookReading` unchanged for the line and clock. `sendCreate` adds `lorebookBranchId`, `lineOnFirstWrite: true` and the `storyClock*` fields to the create.
- The draft resets when the book or the mode changes.
- Shared surfaced books (`isSharedWithMe`, surfaced, not provided) are listed in their own group, and picking one starts a copy (`new-world`).

**Tests:** 4 files, 49 passed.
- `sessions.creationModes.int`:
  - the owner's plain create on their surfaced book succeeds, on the most recent line, with no flag;
  - the owner's branch off: then `ensureSessionLine` forks a line from the chosen one at the chosen date and moves the session onto it;
  - another user, with the book shared to them: a plain create is refused, a copy works;
  - the flag is refused on a copy, with no book, and on a book the asker doesn't own;
  - the surfacing session and its branch are unchanged.
- `surfacedBooks.int`: the owner gets null, another user gets the sentence.
- `startSessionModes.dom`: an own surfaced book shows the two starts; Branch off sends the flag and the line; Continue sends neither; a shared surfaced book starts a copy.
- `ownBook.int`: green.

**Docs:** `docs/lorebooks.md` l.174; `docs/sessions.md` step 6 bullets and the Next chapter sentence.

## Goal 2: the seat-changes read (genres opt in)

Owner, 2026-11-09: "Yes, a read genres opt into".

**Where the changes are kept: no new storage** (the first preference). They are derived from the existing ledger, `session_changes`. The one seat writer's `announceSeatChanges` already records `member-added` and `member-removed` there, and the bench records `cast-changed`. Each landed line records `message-completed`. Nothing re-diffs seats, and `seats.ts` is unchanged. The "turn record" is three files: `messages/sessionChanges.ts` (reads of the ledger), `pipelines/routines/moments.ts` (the `turn-ended` payload) and `pipelines/routines/evaluate.ts` (`causeOf`).

**What "since the previous turn" means**
- It is the ledger ids after the previous turn-taking line of the same lane landed, up to this line's latest landing.
- A line from before the ledger existed falls back to the highest ledger id at or before that line's `created_at`.
- Each row's ref is resolved with `seatOf` and keyed by `hostSeatRefOf`, which is the member form.
- Adds and removes are netted per seat. A seat that nets to zero is `changed` only if it also has a `cast-changed` row whose change is not `position`. Envoys are skipped.

**The opt-in**
- The genre declares `shape.turnSeatChanges: true`. This reuses the genre shape, in the same pattern as `forms.modelAnswers`.
- Only then does `noteLineLanded` put `turnSeatChanges` on `turn-ended`, as `[]` when nothing changed. `causeOf` copies it onto the routine's `cause`.
- Without the opt-in, the payload is exactly as before and the ledger is not queried.
- A failed read never holds back `turn-ended` (a guard added by the supervisor).
- A pass is an ordinary registration: `register(afterEachTurn(), pass, { allowStacking: true })`.

**SDK changes** (🚧 @experimental, with one JSDoc sentence per field)
- `TurnSeatChange { ref, seatKind, castMemberId, change: 'added'|'removed'|'changed' }`, with a ⚠ "not" line.
- `SessionChangePayload.turnSeatChanges` and `RoutineCause.turnSeatChanges`.
- `SessionShape.turnSeatChanges?: boolean`.
- `genre()` refuses a non-boolean value.
- `INTEGRATING.md`: §1i Routines bullet, and a row in the §5a census.
- `guides/genres-presets-and-routines.md`: new section "A pass over the seats that changed". Its example is type-checked by `guideSnippets.test.ts`.

**Tests**
- App: `seatChangesOfTurn.int`, 5 tests (one, the fallback window, added by the supervisor).
  - The changes since the previous turn, covering carded and card-less character seats, persona and card-less player seats, and added, removed and benched ("changed").
  - The next turn reads `[]`.
  - An add plus a remove inside one turn leaves the seat out, and so does a reorder on its own.
  - A line on another lane doesn't end the story lane's window.
  - Not opted in: no key. Opted in: the list, or `[]`.
- App: `evaluate.test` gained one case.
- App regressions, all green: `routines.int`, `sessionChanges.int`, `seats.int`, `sessions.seatEvents.int`.
- SDK: `sdk-tests` `tsc --noEmit` reports 0 errors. `genreSeatChanges`, `genreCastFromLorebook`, `guideSnippets` and `cadences` pass, 48/48. The full `sdk:test` was left for the grouped verification.

## Fixes the supervisor made after reviewing the workers
- `latestChangeIdAtOrBefore` now uses drizzle `lte` instead of a raw `sql` with a Date parameter.
- The guard around the opt-in read: a genre lookup failing on any session would otherwise have skipped `turn-ended` entirely.
- The fallback-window test.
- The rename `seatChanges` → `turnSeatChanges`, which answers scope-review finding 1.
- `TurnSeatChangeRead` is marked ⏳ (R6).

## tsc and check
- tsc: 3 before, 3 after.
- check: 3 errors / 8 warnings before, 3 / 8 after.
- The 3 errors in each are the known `overhear-seat` ones (`sessionPage/requests/index.ts:627` ×2, `overhearSeat.ts:11`). They wait on `sdk:build`.
- **No new error waits on the build.** After the build, two things can be tidied, neither required:
  - `evaluate.ts:115-116` sets the field through a cast `(base as { turnSeatChanges?: unknown })`, which could become a plain assignment;
  - `moments.ts`'s ⏳ `TurnSeatChangeRead` could be swapped for the SDK's `TurnSeatChange`.

## Open ★ (each built as recommended)
- **★c-1: what "most recently active line" means.** `mostRecentBranchOf` is used: the most recently *played* line (ruling 15 as written in `state/reading.ts`'s header). The brief's gloss was "the line the book's most recent write landed on". The header explains why play beats the latest write: an author's correction on main, or a pipeline's write, would otherwise steer every reader. No column needed. *Recommend: keep.*
- **★c-2: goal-1 copy.**
  - **How it starts**
  - **Continue the latest line**: *Picks up the line played most recently, where the story stands now.*
  - **Branch off at a point**: *Pick a line and a date. The first time this session writes to the lorebook, a new line forks there.*
  - Shared group heading: **Start from a shared session's lorebook**
  - Shared group note: *Someone shared their session's lorebook with you. The new session starts on a copy; theirs stays as it is.*
  - Per-row line: *Shared by ‹owner›*
  - Refusal: "Only a lorebook of your own can be branched off at the start. Choose one of yours, or start on its latest line."
- **★c-3: shared surfaced books are new to the start form.** Before this, the form listed no shared book at all. The brief asked for them as copy-only. *Recommend: keep.* Ordinary shared books are still not offered for copying (see Noticed).
- **★c-4: branch off is accepted for any book you own and read directly**, not only a surfaced one. The form offers it only for surfaced ones. This also narrows the old bare spread, which let any create set the flag. *Recommend: keep.*
- **★c-5: the new names.** `TurnSeatChange` · `turnSeatChanges` (payload and `RoutineCause`) · `SessionShape.turnSeatChanges`.
  - The first name was `seatChanges`. The scope reviewer flagged an R1 collision: Dungeon Crawler's published `plan.seatChanges` holds slot writes, and the fold also has a `seatChanges` result.
  - The shape flag shares the field's name, as `scenario` and `tags` name what they enable.
  - *Recommend: keep.*
- **★c-6: the semantics.**
  - The window is per lane, between landings.
  - A turn is any line that takes a turn, a person's or a reply. A regenerate widens the window, so it repeats that turn's list.
  - `changed` = switched on or off, or portrayal moved. A reorder is not a change.
  - Envoys are left out; their events come from `envoys.ts`.
  - *Recommend: keep.*
- **★c-7: the `genre()` refusal.** "`<id>.shape.turnSeatChanges must be true or false. Declare turnSeatChanges: true for turn-ended to carry the seats that changed, or leave it out.`"
- **★c-8: what a non-owner sees on a plain create.** A non-owner's plain create on a shared surfaced book still hits the existing ownership throw ("Access denied…"), which the socket catch-all replaces with a constant. `SURFACED_BOOK_REFUSAL` is never reached. The brief allowed either. *Recommend: leave it.* The other option is to move the surfaced check above the ownership check, so they get the sentence.

## NOMENCLATURE rows queued (the lead merges)
- **§24 surfaced book row.** Three corrections:
  - signature: `surfacedBookRefusal(db, { lorebookId, creationMode, userId })`;
  - read rule: read directly by its **owner** (who may start a new session on it: continue the latest line, or branch off at a point), by its session's branches and by its next chapters; anyone else it is shared with starts on a copy;
  - start form: own surfaced books stay in **Your lorebooks**; the group is now **Start from a shared session's lorebook**, for shared ones only.
- **§9 session create:** `sessions:create` honours `session.lineOnFirstWrite` only on a start that reads a book the asker owns directly, and refuses it otherwise (★c-4). It is never taken from the bare spread.
- **§4 / §9 session moments:**
  - 🚧 `TurnSeatChange` (`ref`, `seatKind`, `castMemberId`, `change`);
  - 🚧 `turnSeatChanges` on `turn-ended` and on `RoutineCause`;
  - 🚧 `SessionShape.turnSeatChanges` (off in core, P1);
  - ⚠ not `CastChangePayload`, not the host's `SeatChange`, not Dungeon Crawler's `plan.seatChanges`.
- **App, 🚧:** `seatChangesOfTurn`, `sessionReadsSeatChanges`, `turnLineWhere`; in `sessionChanges.ts`, `latestLandingId`, `latestChangeIdAtOrBefore`, `SeatEventRow`, `seatEventRowsBetween`; ⏳ `TurnSeatChangeRead`; `SURFACED_STARTS` in the start form.
- **§25 ledger entry, "2026-11-09 (lane s4-follow-c)":** all of the above, plus the rename from `seatChanges` (never published).

## Noticed, not done
- **A rule was broken.** Worker 1 ran `prettier --write` on the **whole** `StartSessionForm.svelte`, against the brief. Compared with a 2026-11-08 copy (`scratchpad/ssf.svelte`), it differs from prettier's output on about 246 lines, so other lanes' markup was probably reflowed and Tailwind classes re-sorted. The changes are formatting only, the tests are green, and there is no pre-image to undo it from. **Lead's check:** no template line starts with punctuation and no `>.`-style split exists, so no visible spaces were introduced.
- `prettier --check` fails on `moments.ts`, `evaluate.ts`, `evaluate.test.ts`, `sessionChanges.ts` and `docs/pipelines.md`. Most of it is on lines this lane didn't write, but a few of the lane's long lines in `moments.ts` / `sessionChanges.ts` probably fail too. None were `--write`n. `ownBook.ts` and `sessions.ts` fail only on others' lines.
- `sessions:create` still bare-spreads `params.session` into the insert, so a client can write other columns such as `branchAncestry`. Only `lineOnFirstWrite` is closed now.
- Ordinary (not surfaced) shared books are still never offered for copying on the start form, although "read and copy only" is their rule.
- An R1 collision that already existed: Dungeon Crawler's `plan.seatChanges` (`core-catalog/.../dungeon-crawler/scripts.ts:227`, `interview.ts:141`) means slot writes, while the fold's `seatChanges` means `SeatChange[]`.
- `announceSeatChanges` nets add, remove, add of one ref within a single call to nothing. The turn read counts instead, so it is unaffected.
- `sessionReadsSeatChanges` reads the genre list (`listSessionGenres`) once per turn for every session: one extra read per turn; the ledger query runs only for genres that opt in.
- A seat named by a pipeline (`runtime/host.ts` `writeSeatName` with no collector) still announces nothing, so it never reaches the turn read (also noted by follow-a).
- The guide section and INTEGRATING text are compiled only by the targeted tests; the full `sdk:test` (pins, goldens) is for the grouped verification.
- `/tmp/serene-pub-vitest-Mp8YUa` and `-TZqsYB` are follow-a's. This lane removed its own empty `-ug2iSV` by name.

## Scope reviewer's verdict
The lane stayed inside its owned files and regions. Untouched: `seats.ts`, `types.ts`, NOMENCLATURE, `drizzle/` (newest still 0148) and every serene-pub-43 image-generation file. No core genre opts in, and no copy frames a session as having no lorebook. Three findings:
1. **(Medium) R1 on `seatChanges`.** Fixed by the rename to `turnSeatChanges`; carried as ★c-5.
2. **(Low–medium) NOMENCLATURE rows stale or missing.** Queued above, including the surfaced-book row fixes; `TurnSeatChangeRead` is now marked ⏳.
3. **(Low) The whole-file prettier on `StartSessionForm.svelte`.** Recorded above.
