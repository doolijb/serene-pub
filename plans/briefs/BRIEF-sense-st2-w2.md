# BRIEF — sense-st2 worker 2 — `keepOnRetell` in the SDK, and the docs

You are a `lane-worker` for lane `sense-st2` (supervisor: the agent that launched you). Repos:
app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`. Use absolute paths. Report back in your
final message (changed files per repo, tests run with exact results, every user-facing sentence you wrote, anything
you could not do, Noticed-not-done). Do not write a report file. **Do not build the SDK** (`npm run sdk:build`) —
the supervisor builds once after you finish; another lane is building the SDK too.

## The owner's ruling (2026-11-11, verbatim)

Asked: "When a turn is replaced (swipe or regenerate), should everything that turn wrote go back with it, including
its clock moves and scene boundaries? This narrows your 2026-10-17 ruling 'a swipe re-tells, never re-plans'."
Answer: "Yes, a turn owns what it wrote" — "Swipe, regenerate and Back all take back the same set: state, clock
moves, scene boundaries, draws. A genre can declare what it keeps across a re-tell. One undo rule for modders."

## What the app now does (worker 1 is building it; describe exactly this)

Two cases, one rule: a turn's message is **replaced** (swipe, regenerate, a run that failed) or **leaves** (Back,
delete). Both take back everything the turn wrote: stats and values, suggestions (proposals), configurations, clock
moves, **scene boundaries (a scene it began or ended — now on a swipe and a regenerate too, and on a delete)**, scene
notes, who holds what (zones), lorebook writes and session notes, cast versions, ruleset conversions, seat benches,
and the session's annex writes. Forward puts back what Back took; a failed swipe puts back what the swipe took.
Exactly two exceptions on a **replaced** turn:

1. A **round's move of the clock** (cause `tick`: `core:spec/round-tick`, or the Lair keeper's round worth) stays,
   because the new reply keeps the same message and does not end the round again (the turn tally never counts a
   message twice). Back and delete take it, and the next line that closes the round moves it again, once.
   This is interim, pending the owner's ruling (★ST2-1); `docs/lorebook-time.md` line ~119 already says it.
2. An annex field declared **`keepOnRetell: true`** keeps its value when its turn is replaced; it still goes when the
   turn leaves. Absent means it goes. The Dungeon Crawler declares it on its plan fields, so a swipe there still
   tells the same turn again from the same plan (the 2026-10-17 behaviour, now that genre's declaration and nobody
   else's).

Two more changes:

- **A run a person started with a press** that opens no message of its own now anchors its annex writes to the
  session's newest message, so Back past that message takes them (before: no anchor, lasting at once). A person
  setting an annex field's value through its own action (`<owner>:annex#<key>`, the Annex widget) is the person's own
  edit and stands. A lorebook row a press files on its own (*File as a room*) still has no anchor and stays.
- **Seat benches** (A2): a seat a replaced turn benched or brought back is put back with the turn, like every other
  write. A genre that keeps its plan files the plan's seat changes again when it tells the turn again (the Dungeon
  Crawler's re-telling re-files the companions' fates, its clock move and its sheet changes, once); a failed re-tell
  puts everything back. Nothing the plan decided about seats is kept apart from the plan.
- **Draws** (ruleset decks, the core runtime key `rulesetDecks`) are not anchored to a turn today and neither case
  takes them; that is the next lane's (ST3). Do not describe draws as taken.

## Part A — the SDK (`/home/jody/github/serene-pub-sdk`)

1. `sdk/src/annexFields.ts`: add `keepOnRetell?: true` to `AnnexFieldDecl` and `AnnexFieldInput`, with a doc comment
   (🚧, `@experimental`) modelled on `nextChapter`'s: the value stays when the turn that wrote it is replaced (a swipe,
   a regenerate, a failed run) and goes when the turn leaves (Back, delete); for a genre that tells a turn again from
   what it decided; session scope only. Add **⚠ Not a cast member's _retold_ field** (NOMENCLATURE §8 **retold** —
   a card field told in the member's own words; a near-neighbour word). `annexFieldFindings`: a value other than
   `true` → `${where}.keepOnRetell: true or absent — the value stays when its turn is told again`; on `scope: 'user'`
   or `scope: 'lorebook'` → `${where}.keepOnRetell: only a session-scope field is taken back with its turn, so only
   one can be kept` (wording yours, one sentence, in the file's style). `annexField()` carries it onto the frozen
   declaration exactly as it carries `nextChapter`. Grep the SDK for every other place `nextChapter` of an annex field
   is listed (a manifest schema, a docs page, an API report) and add `keepOnRetell` beside it; list what you found.
2. `core-catalog/src/shared/annexField.ts`: `keepOnRetell: true` on the Dungeon Crawler's `DC.progress`,
   `DC.planningNotes`, `DC.planningNotesRevealed` and `DC.journal` fields (not `legacyWorld`, not `lanes`: nothing
   writes them). One comment above `DUNGEON_CRAWLER_ANNEX_FIELDS` saying why: the story turn's re-telling
   (`story.ts`, the books' `redo`) files none of these again — its plan (`progress.lastTelling`), notes and journal
   stand — while what the plan applied (sheet changes, the clock, the companions' fates) is taken with the row and
   filed again once. Do not touch `core-catalog/src/shared/roundTick.ts`, `pipelines/boot/store.ts`, or any hash pin
   file (another lane owns them).
3. SDK test: add `sdk-tests/keepOnRetell.test.ts` (style of `sdk-tests/nextChapter.test.ts`, `node:test`): true is
   carried; absent stays absent; `false` refused with its sentence; `scope: 'user'` and `scope: 'lorebook'` refused;
   the four Dungeon Crawler fields in core-catalog's `CORE_ANNEX_FIELDS` carry it and the other core fields do not.
   You cannot run it yet (the tests resolve `@serene-pub/sdk` through its built `dist`); the supervisor runs it
   after building. Check it typechecks against the sources by reading carefully.
4. `guides/storage.md` (SDK repo): the "What happens to each home" table's rows **Swipe or regenerate** and
   **Back, or delete** become two rows of behaviour: **A turn is replaced** (a swipe, a regenerate, a run that
   failed) and **A turn leaves** (Back, a delete), each cell true to the section above. Rewrite the exceptions
   list: the "A swipe keeps the turn's `session`-scope annex writes" bullet goes; add one bullet for the two
   exceptions on a replaced turn (the round's move; `keepOnRetell`), one for the press anchor (and that a person's
   own value through an annex field's action stands, and a press's own lorebook row stays), and say seat benches go
   with the turn. In "A value a widget saves: annex fields", add a `keepOnRetell` bullet beside `genre`. Keep the
   guide's voice: short declaratives, no marketing.

## Part B — the app docs (`/home/jody/github/serene-pub`)

5. `docs/sessions.md`:
   - "Regenerate, Extend and Swipe" (~277–289): the paragraph at ~285 says a regenerate or swipe "takes back
     everything the old reply changed". Make it true and complete: add the scenes it began or ended and what it
     wrote in the session's data; the round's move of the clock stays (the new reply doesn't end the round again;
     link `./lorebook-time.md#the-story-clock`); a genre may keep its plan across a new telling (the Dungeon Crawler
     does: link its doc). Keep "If the new version fails, the old reply's changes all come back."
   - The paragraph after it: Back, Forward, Delete "take back the same things" — keep, and say the one difference
     (Back and delete also take the round's move and a genre's kept plan).
   - "Back and Forward" (~243): the sentence "Three things stay: … and what a button you pressed filed on its own,
     such as **File as a room**." Now a button's changes to the session's data go with Back past it; what stays is a
     lorebook row a button filed on its own (*File as a room*) and a value you set yourself on a widget. Keep the
     other two things that stay.
6. `docs/genre-dungeon-crawler.md` (~251, the Swipe bullet): add that the Planner's plan, its notes and the journal
   stay as the turn left them, while the sheet, the clock and where everyone stands are taken and filed again once.
   Do not change line ~272 (the reveal's "can't be taken back" — the supervisor raises it with the owner).
7. `NOMENCLATURE.md`:
   - The **annex field** row (§9, line ~581, starts `| **annex field** · **annex declaration**`): append one
     sentence: 🚧 **`keepOnRetell: true`** (2026-11-11, S2): the value stays when its turn is replaced (swipe,
     regenerate, a failed run) and goes when the turn leaves (Back, delete); session scope only; the Dungeon
     Crawler's plan fields declare it. ⚠ Not a cast member's **retold** field (§8).
   - §25 Change ledger: add a subsection after the last `### …` subsection of §25 (re-read the file first: another
     lane may be appending there; insert with a unique anchor and never overwrite their lines):
     `### one undo rule: a turn replaced or leaving — 2026-11-11 (owner ruling ★S2; PLAN-sensible-engine §1.3 Rule 1; lane sense-st2)`
     with a `| Was | Is | Why/where |` table: (a) four undo verbs with three flags (`retractStateAnchoredTo(db, id,
     { ticks, scenes, annex })`; swipe kept annex writes, ticks and scene boundaries; regenerate kept ticks and
     boundaries; delete kept boundaries) → _(internal)_ two cases `retractStateAnchoredTo(db, id, "replaced" |
     "leaves")`; both take scene boundaries and annex writes; a replaced turn keeps the round's tick (★ST2-1 interim);
     (b) _(new)_ → 🚧 **`keepOnRetell: true`** on `AnnexFieldDecl` / `AnnexFieldInput`, refused unless `true` and on
     a `user` or `lorebook` field; the Dungeon Crawler's four plan fields; ⚠ not **retold**; (c) a press-started
     run's annex writes had no anchor → anchored to the session's newest message; an annex field's own action stands;
     (d) _(internal)_ `AnnexDeltaTaken.narrowed` and `retractAnnexDeltasAnchoredTo(tx, id, { keep })`. Where column:
     the files (`state/write.ts`, `sessions/annexChanges.ts`, the five call sites, `host.ts` `writeAnnexDocument`,
     `sdk/src/annexFields.ts`, `core-catalog/src/shared/annexField.ts`, `guides/storage.md`, `docs/sessions.md`,
     `docs/genre-dungeon-crawler.md`).

## Files owned (only these)

SDK: `sdk/src/annexFields.ts`, `core-catalog/src/shared/annexField.ts`, `sdk-tests/keepOnRetell.test.ts` (new),
`guides/storage.md`, and any spot you find that lists annex-field options (report each before editing if it is not
a plain list beside `nextChapter`). App: `docs/sessions.md`, `docs/genre-dungeon-crawler.md`, `NOMENCLATURE.md`
(the two places above only). Readable: anything.

## Out of scope

Any app source file; `roundTick.ts`; `boot/store.ts`; hash pins and the catalogue digest; `docs/lorebook-time.md`,
`docs/stats-and-states.md` and other docs (list contradictions you see under Noticed-not-done); the reveal's copy;
any UI.

## Stop and report when

A name other than `keepOnRetell` would be exported; a published name would change; a manifest schema or stored-data
shape needs changing beyond the optional key.

## Done means

- Every file above edited; `npx prettier --check <file>` on each changed `.ts` file (from the repo that owns it; for
  the SDK run it from `/home/jody/github/serene-pub` with the absolute path if the SDK has no prettier).
- In the SDK, a typecheck that does not build `dist` and does not run at the SDK root: e.g.
  `cd /home/jody/github/serene-pub-sdk/sdk && npx tsc --noEmit -p .` (if that package has no tsconfig of its own,
  say so and skip). Report the result.
- Your report lists every user-facing sentence you wrote, marked as provisional copy.

## Verbatim rules (from `.claude/guides/multi-agent.md` and `plans/briefs/BRIEF-sense-clk.md`)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not build in this task.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. It is a **session**, never a *chat*. Every session has a
  lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Never `npm install` or any `npm` command at the SDK root.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.**
- NOMENCLATURE §1: R1 one word, one meaning; R2 distinctive words; R3 qualify, never the bare noun; R6 mark 🚧
  provisional vocabulary. §24: grep a new word first; say what it is **not** when a near-neighbour exists.
- STYLE-GUIDE §10 Writing (verbatim excerpts): "Sentence case everywhere"; "One name per thing, across the whole
  flow: the thing you open is a session, never a chat"; "errors say what went wrong and what to do"; "No filler".
  Follow the docs' existing voice: UI labels in **bold**, quoted on-screen copy in *italics*.
