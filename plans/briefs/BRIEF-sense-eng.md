# BRIEF — lane `sense-eng` (wave 1) — engine truth fixes

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then what this lane triggers: CLAUDE.md
Hard rules, `docs/group-sessions.md` (Turn order), `docs/lorebook-time.md`, `docs/stats-and-states.md` ("When a
session changes the lorebook"), NOMENCLATURE §1 and §24 (you should need no new name; if you do, stop and ask).

Plan: `plans/PLAN-sensible-engine-2026-11-11.md` (Part 5 is what the owner's go covers). Evidence for each item:
`plans/REVIEW-sensibility-2026-11-11.md`, rows A1, G2.2, B11. **Re-read the cited lines before changing anything**;
a review row marked "? inferred" is yours to confirm first, and if it turns out false, report that and do not "fix" it.

## Goal — three small fixes where the engine contradicts its own rule

1. **The turn pool honours the bench (review A1).** `core:task/turn-pool@1` in
   `src/lib/server/pipelines/runtime/bindings.ts` (about lines 4442–4520) spells its own conditions. A benched seat
   (`is_active` false, `removed_at` null; the cast read hands it out with `enabled: false`) must never be a
   candidate, for character seats and player seats alike. Use the one rule, `inPlay`
   (`$lib/shared/sessions/inPlay`), as `sessions/seats.ts` (about line 1745) says every reader of turns must.
   - Today `params.characters === "all"` lets a benched character back in, and the player-seat filter has no bench
     test. After this lane, `all` reads the same as `active` for bench purposes. **Do not change the node's
     declaration or its option list** (it is a published SDK name). Report the now-meaningless `all` option as an
     open ★ with one recommendation.
   - Envoy seats: on an envoy seat `is_active` means switched off (`sessions/seats.ts` about 1815). Keep what the
     pool does for envoys today unless it lets a switched-off envoy in; say what you found.
   - Confirm or refute the review's inference that a benched player can be shown as "‹name›'s turn" today.
2. **Deleting a session never writes to a lorebook its owner does not own (review G2.2).** In
   `src/lib/server/state/durable.ts`, `recordToTimeline` with `reason === "delete"` routes to the attached book
   whenever the mode is not Off, with no ownership check. Add the same ownership test `loreWriteRoute` applies
   (`src/lib/server/lorebooks/ownBook.ts` about 345): when the session's owner does not own the attached book,
   the delete path records nothing. **Keep the rest of the delete safeguard as it is** (plan A22's table: Full and
   Review write the book; Off and no attached book record nothing). Do not touch the scene-close callers.
3. **A first clock move by an amount starts the clock (review B11, first half only).** In
   `src/lib/server/state/storyTime.ts` (`moveSessionStoryClock`, about 400–445) a move TO a time of day on a story
   with no clock and no present starts at `FIRST_STORY_DAY`; a move BY an amount refuses ("not on the clock. This
   story has no clock yet…", see also `state/clockMoves.ts` about 86–98). Make a move by an amount start from
   `FIRST_STORY_DAY` the same way, store the clock, and announce it exactly as the other path does. Same locks and
   every other refusal unchanged. Not in scope: which calendar a new lorebook is born with.

## Files owned (the only files this lane may edit)

- `src/lib/server/pipelines/runtime/bindings.ts` — the `core:task/turn-pool@1` binding only.
- `src/lib/server/state/durable.ts`, `src/lib/server/state/storyTime.ts`, `src/lib/server/state/clockMoves.ts`.
- The test files beside those modules, and the turn-pool / turn-order / bench test files that cover item 1.
- `docs/group-sessions.md`, `docs/lorebook-time.md`, `docs/stats-and-states.md`, `docs/sessions.md` — only the
  sentences these three changes make untrue.

## Files readable

Everything. In particular `src/lib/server/sessions/seats.ts`, `src/lib/shared/sessions/inPlay.ts`,
`src/lib/server/pipelines/runtime/host.ts` (the cast read, about 5160), `src/lib/server/lorebooks/ownBook.ts`.

## Out of scope — written down, never built

`runtime/host.ts`, `sockets/sessions.ts`, `sockets/scenes.ts`, `db/schema.ts`, any migration, the SDK repo, the
turn-pool node's declaration, `recordToTimeline` at scene close, default calendars, anything in the plan's other lanes.

## Stop and ask (through your report) when

CLAUDE.md §Decisions applies: a new name, setting, flag, event, table or migration; copy a user sees that is new
(list every new or changed sentence as provisional 🚧 copy); a file outside **Files owned**; a review claim that
turns out false.

## Done means

Each item has a test that fails before and passes after: a benched character with `characters: "all"` is not a
candidate; a benched player seat is not a candidate; a delete on a book the session owner does not own records
nothing while a delete on their own book still records; a move by an amount on a clockless story starts at the
first story day. Run only those targeted test files, in a capped scope:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
`npx prettier --check <file>` on each file you changed.

## Report

`plans/REPORT-sense-eng-2026-11-11.md`: changed files, tests run with results, what you confirmed or refuted of the
review's inferences, open ★, provisional copy, **Noticed, not done**.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` in either repo. Inside
  `db.transaction(async (tx) => …)` use only `tx`. It is a **session**, never a *chat*. Every session has a lorebook
  (its own book, or an overlay): never write "no lorebook" in code comments, copy or your report.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
