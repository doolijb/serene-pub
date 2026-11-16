# BRIEF — build lane `time-t10` — a session's clock moved back past its own writes follows **On revision**

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §6 (T10) and §8 ★12, `plans/NOTES-entry-time-and-lines-2026-11-13.md`
(~88–93 and ~376–380), `src/lib/server/sessions/revision.ts` (all of it), `src/lib/server/sessions/branch.ts`
(its header and the `branch` built-in), `src/lib/server/sockets/storyClock.ts`,
`src/lib/server/state/clockProposal.ts`, `plans/REPORT-time-t5a-2026-11-15.md` (what a dated session writes
now), `docs/sessions.md` (On revision; the story clock), `docs/lorebook-time.md`, `NOMENCLATURE.md` §1, §24 and
the rows for **On revision**, *story clock*, *line*.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no GPU.

## Goal

When a session's story clock is moved **back** to before a date at which that session has already written
something dated into its lorebook (an entry version, a cast version, a history day, a dated tie or stat), the
move is never silent: it follows the session's existing **On revision** setting, and the confirmation says which.

- **Overwrite** (the default): the clock moves back on the same line. Nothing already written is removed. Play
  goes on and writes at the earlier date; what the session wrote at later dates stays and reads again when the
  story reaches those dates.
- **Branch**: the session branches at the current message and the clock moves back on the branch; the lorebook
  line forks at the date moved to, so the later writes stay on the old line and the new play does not see them.

A move back that passes none of the session's own dated writes, a move forward, a session with no clock, and a
lorebook with the Timeline off behave exactly as today. A pipeline's or a routine's clock move never moves the
clock back past the session's writes by itself: it is refused with a sentence (P1: no silent automatic action),
and a keeper's proposed move is offered to the person as today.

## Owner rulings (quote them in worker briefs)

- 2026-11-14, "Lets go with all your recommendations", which rules ★12: "The clock moved back uses **On
  revision** (no separate answer for deleting a turn and for moving the clock)" and the simplification "The
  clock moved back past the session's own writes uses the session's existing *On revision* (overwrite or
  branch). No new setting; 'flashback' is the same line, writing at the earlier date."
- 2026-11-13 (the lead's answer the owner did not dispute; unruled in detail): "When a session's story clock
  moves back past things that session already wrote, a choice is required, never made silently."
- 2026-10-16: **On revision** itself (`sessions/revision.ts`: `overwrite` / `branch`).
- 2026-11-15: "Go ahead and proceed with everything in the order you see fit." — the go.

## Build

### A. Inventory first (supervisor, read-only) — report with file:line

1. Every way a session's clock moves: a person's **Move the clock…** and **Next day** (`sessions:setStoryClock`
   or its current name in `sockets/storyClock.ts`), **Follow the line's present**, the round's automatic step,
   **Time passes…** and a pipeline's clock outlet (`clockMoveProblem`, `state/clockProposal.ts`), a keeper's
   proposal. Which can move it back today, and what each does about earlier writes (nothing?).
2. How to know "this session wrote something dated after date D on its line": the rows that carry the session
   and a date (entry versions with `source_session_id` or the per-turn record of lane `time-t5a`; cast versions'
   `sourceSessionId`; history days and scenes of the session; dated ties and stats). One query, read only, with
   a count and the latest date, enough for the sentence.
3. What **Branch** needs: `sessions/branch.ts` forks a session at a message; how the lorebook line is forked for
   a branched session today and at which date (the fork date is the branch point's story date). Can the fork
   date be the date moved to, not the date of the message? If not without changing `branch.ts`'s rule, **stop
   and report**: the smallest honest alternative is to branch at the message and say so.
4. Where the confirmation for **On revision** is said today (`revisionNotice`) and how the client asks before a
   revision; whether the same dialog can carry a clock move.

### B. The rule

- One server function decides, for a requested clock move: not back past the session's writes → proceed as
  today; back past them → the reply is a refusal that carries a notice (mode, how many dated writes lie after
  the new date, the latest of their dates in words, the one sentence), unless the request says the person
  confirmed. Sentences 🚧:
  - Overwrite: *This moves the story back before ‹n› thing(s) this session has written, the latest dated
    ‹date›. They stay in the lorebook and read again from their dates.*
  - Branch: *This branches the session here and moves the branch's story back to ‹date›. What this session has
    written after that stays on the line it leaves.*
- A confirmed move under Overwrite moves the clock (nothing else). Under Branch it runs the existing branch
  built-in, then sets the branch's clock.
- A pipeline's or routine's move back past the writes is refused with *The story clock was not moved back: this
  session has written at later dates. Move it by hand to choose what happens.* 🚧 and the run's note says so.

### C. The client

The Chronicle's and Session settings' clock controls show the confirmation (the server's sentence) before a move
back that needs it, with the mode named, and send the confirmed request. No new setting. If the Chronicle's
form (an SDK component) cannot show a server-supplied confirmation without an SDK change, the session page's
own handler asks instead; **no SDK edit in this lane** (report what would be cleaner later).

### D. Docs and names

`docs/sessions.md` (On revision: also a clock moved back), `docs/lorebook-time.md`; `NOMENCLATURE.md`: the **On
revision** row widened (its charter: it owns what a revision does to the timeline; a clock moved back past the
session's writes is a revision), §25 for every new name. No other product's name.

## Files owned

`src/lib/server/sockets/storyClock.ts`, `src/lib/server/state/clockProposal.ts`,
`src/lib/server/sessions/revision.ts`, a new small module beside it for the "writes after a date" query,
`src/lib/shared/sockets/types.ts`, the session page's clock handler and its dialog under
`src/lib/client/components/sessionPage/` and the session settings' clock control, tests beside each, the docs
above, `NOMENCLATURE.md`. `src/lib/server/sessions/branch.ts` only to call it; changing its rule is a stop.

## Out of scope

Removing or marking later versions; a "flashback" mode; a third On revision mode; cast Memory; the SDK's
Chronicle component; `src/lib/server/pipelines/runtime/host.ts` beyond the one refusal if the clock outlet lives
there (then only that).

## Stop and ask when

CLAUDE.md §Decisions applies; Branch cannot fork the lorebook line at the date moved to; a setting, an event or a
published name seems needed; the query cannot tell the session's own writes from others'.

## Done means

- Tests, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t10-<name>.log 2>&1"`,
  one at a time, checking for a running vitest first: a move back past nothing, forward, no clock, Timeline off
  → as today; back past the session's writes → refused with the notice, then moved when confirmed (Overwrite:
  the later writes remain and read again from their dates; Branch: the branch reads none of them, the old
  session and line untouched); another session's later writes do not count; a pipeline's move back is refused
  with its sentence; the dialog.
- The wider regression: `src/lib/server/sockets/sessions.*`, `src/lib/server/sockets/storyClock*`,
  `src/lib/server/state`, `src/lib/server/sessions`, `src/lib/server/pipelines/routines`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t10-<date>.md`): the inventory with
file:line, the rule as built, changed files, tests with results, names and sentences, open ★, Noticed not done.
Under about 700 words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

Checked and fine: "Overwrite removes nothing" is the ruled reading (the 2026-11-14 simplification: "flashback is
the same line, writing at the earlier date"; the earlier option "later versions marked" was dropped); it is
already today's behaviour (a set is a column write, `storyClock.ts` ~206–219; later-dated rows are cut by the
reading's moment, `lineReading.ts` ~369–372), so **under Overwrite this lane adds only the confirmation**.
Branch needs no change to `branch.ts`: a branch rides its parent's line and forks "at the session's day" on its
first write (`branch.ts` ~173–177; `lorebooks/sessionLine.ts` ~1–10, ~115–125): branch, then set the clock to
the date moved to, and the line forks there. The Chronicle shows any refusal as "Not done: ‹reason›"
(`ChronicleWidget.svelte` ~134–151), so the confirmation is the page's `set-story-clock` handler's, as Build C's
fallback says; no SDK edit.

1. **Nothing automatic moves the clock back today; the one pipeline path that does is a person's own press.**
   **Time passes…** has Forward or Back (`docs/sessions.md` ~214) and goes through the clock outlet with
   `cause: 'action'` (`host.ts` ~10600–10650; the SDK's `shared/timePasses.ts`). The keeper is forward only
   (`state/clockProposal.ts` ~20–21, ~67–68), clock targets never move back (`state/storyTime.ts` ~437–441),
   rounds step forward. So: `cause: 'action'` is a **person's** move. Because an action's run cannot stop to ask,
   a **Time passes…** move back past the session's dated writes is refused with a sentence that sends the person
   to the clock control: *This would move the story back before things this session has written. Use **Move the
   clock…** to choose what happens.* 🚧 Any other backward move by a pipeline or routine is refused with the
   guard sentence of Build B (it cannot happen today; say so in the inventory). Drop the keeper clause.
2. **Session settings saves the clock through another path.** The form saves through `sessions:update`
   (`sessionForms/EditSessionForm.svelte` ~1413, `sessionReadingPatch.ts` ~11–30), whose handler writes the clock
   with `sessionLinePatch` (`sockets/sessions.ts` ~6841–6852), not through `storyClock.ts`. Added to Files
   owned: the clock part of that update handler and `sessionForms/EditSessionForm.svelte`, with the same check
   and the same confirmation (the save is refused with the notice until confirmed). `sockets/sessions.ts` is a
   shared file: touch only that part.
3. **Say "dated".** Undated rows are never cut by a line (`lineReading.ts` ~368–371): perpetual entries and
   undated ties the session made stay readable on the branch. The Branch sentence reads *…What this session has
   written **dated** after that stays on the line it leaves.* 🚧, the tests assert dated rows only, the docs say
   perpetual entries read on both lines, and a test shows the branch's first write after the move forks the line
   at the date moved to (a second clock move before any write moves the fork with it: say so in the docs).
4. **Where "this session wrote it" is stored.** `entry_amendments` has no session column (`sourceMessageId`
   only, on held rows). The sources are: the session's per-turn records of kind `version` and of ties
   (`lore_imprints.session_id`; settling keeps the rows as `settled`), cast versions' `sourceSessionId`
   (`schema.ts` ~9703), and the session's scenes and the history days they are filed under. A version another
   session also wrote into counts as this session's write. Deleted versions take their records with them.
5. **The word Overwrite now covers two behaviours** (a turn: the later material is taken back; the clock: nothing
   is removed). The widened **On revision** row in NOMENCLATURE and the Overwrite bullet in `docs/sessions.md`
   state both; the clock confirmation never uses "overwrite" as a verb.
