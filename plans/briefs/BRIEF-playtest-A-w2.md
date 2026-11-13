# BRIEF playtest-A-w2 — why a clock move was skipped, and the refusal's words (item 13 B + C, part)

Lane `playtest-A`, worker 2. Supervisor reads your final message (your report); do not write a report file.
App: `/home/jody/github/serene-pub`. SDK: `/home/jody/github/serene-pub-sdk` (edit the SDK there). Absolute paths.

## Goal

Every skipped clock move prints `${head}, not on the clock. ${skipped}` (`src/lib/shared/state/ledgerLines.ts:527`).
"Not on the clock" was coined for the *no clock yet* case; a move the clock **refused** (a dayless clock asked to run
past midnight) reads as nonsense. Store why a move was skipped, read it back on old rows that lack it, and fix the
two refusal sentences in the SDK.

1. **Shared helper and type — `src/lib/shared/state/ledgerLines.ts`.**
   - Move the constant here: `export const NO_STORY_CLOCK_YET = "This story has no clock yet: set one in the lorebook
     to track time."` (exact text unchanged). `src/lib/server/state/clockMoves.ts` imports it from here and
     re-exports it (`export { NO_STORY_CLOCK_YET }`), so every existing importer of `./clockMoves` keeps working.
   - `export const CLOCK_SKIP_KINDS = ["no-clock", "refused"] as const` and `export type ClockSkipKind = (typeof
     CLOCK_SKIP_KINDS)[number]`.
   - `export function clockSkipKindOf(move: { reason?: unknown; skipped?: string | null }): ClockSkipKind | null` —
     null when `skipped` is empty; the stored `reason` when it is one of `CLOCK_SKIP_KINDS`; otherwise derived for an
     old row: `skipped === NO_STORY_CLOCK_YET` → `"no-clock"`, anything else → `"refused"`. This is the ONE helper both
     readers use (below), with a doc comment saying rows written before 2026-11-04 carry no `reason`, so it is derived.
   - `LedgerClockMove` (line ~115): add `reason?: ClockSkipKind | null` with a one-line doc.
   - `clockMoveText`: keep `skipped && by === 0` → the sentence alone. For a skipped step:
     `clockSkipKindOf(move) === "no-clock"` → `` `${head}, not on the clock. ${move.skipped}` `` (unchanged);
     otherwise → `` `${head}, not moved. ${move.skipped}` ``. Applied lines are unchanged. Update the doc comment.
     Do **not** change wording by `cause` (that part is held by the supervisor).
2. **Socket type — `src/lib/shared/sockets/types.ts`, the `LedgerClockMove` interface only (~line 16635).** Add
   `reason?: "no-clock" | "refused" | null` with a doc line (absent on a host that predates it; read through
   `clockSkipKindOf`). Another lane is editing other parts of this file right now: make ONE precise Edit inside that
   interface, never rewrite, reformat or prettier-write the file.
3. **Server — `src/lib/server/state/clockMoves.ts`.**
   - `ClockMovePayload`: add `reason?: ClockSkipKind` (doc: why a skipped move did not happen; rows before 2026-11-04
     lack it).
   - `recordClockMove`: a skipped row's payload also gets `reason: clockSkipKindOf({ skipped: move.skipped })`. (Its
     callers — `runtime/host.ts`, `bindings.state.ts`, `rulesets/clockHours.ts` — pass only the sentence, and are not
     ours to change; deriving here is how new rows get it.) Do not add a parameter.
   - `ClockLedgerRow`: add `reason: ClockSkipKind | null`; `clockLedgerRows` fills it with
     `row.status === "skipped" ? clockSkipKindOf({ reason: p.reason, skipped: p.skipped ?? NO_STORY_CLOCK_YET }) : null`.
   - The module header's `skipped` bullet says "because the story has no clock yet" — widen it to "no clock yet, or a
     step the clock cannot take (`reason`)".
4. **SDK — `/home/jody/github/serene-pub-sdk/sdk/src/storyTime.ts` `advanceStoryTime` (~line 597–601).** `stepDays`
   gets told which unit asked. When the clock has no month/day:
   - a minutes/hours step that carries past midnight → `` `The clock has no date at ${spelled}, so it can't run past midnight.` ``
   - a days step → `` `The clock has no day at ${spelled}, so it can't count days.` ``
   (`spelled` is the existing `formatStoryTime(start, calendar)`.) The months sentence (line ~622) is unchanged.
   Update the doc comment above the function if it quotes the old sentence. No other SDK file changes.
5. **SDK test — `/home/jody/github/serene-pub-sdk/sdk-tests/storyClockAdvance.test.ts`.** Line ~122
   (`{ year: 3, hour: 23, minute: 0 }` + 2 hours, `/no day/`) and line ~77 (`{ year: 3 }` + 1 day, `/no day/`): assert
   the exact new sentences (`assert.equal`), and add one for `{ year: 1, hour: 23, minute: 0 }` + 1 hour, free-form →
   exactly `The clock has no date at Year 1, 23:00, so it can't run past midnight.` (if `formatStoryTime` spells it
   differently, report what it spells instead and assert that — do not change `formatStoryTime`).
6. **Docs — `docs/lorebook-time.md`, line 114.** Keep that paragraph as it is and add one new paragraph right after
   it, exactly:
   `When the clock can't take the step, the line says *not moved* and why. A clock with a time of day but no date can't run past midnight: *Time passes: 3 hours, not moved. The clock has no date at Year 1, 23:00, so it can't run past midnight.* One with no day can't count days: *The clock has no day at Year 1, so it can't count days.*`

## Files owned (edit only these)

- `src/lib/shared/state/ledgerLines.ts`, `src/lib/shared/state/ledgerLines.clockNote.test.ts`
- `src/lib/shared/sockets/types.ts` — the `LedgerClockMove` interface only
- `src/lib/server/state/clockMoves.ts`, `src/lib/server/state/clockMoves.int.test.ts`
- SDK `sdk/src/storyTime.ts`, SDK `sdk-tests/storyClockAdvance.test.ts`
- `docs/lorebook-time.md` — the one paragraph above

**Not yours** (read only; report breakage, never edit): `src/lib/server/sockets/state.ts` (it copies the clock fields
onto the wire one by one at ~line 1003, so `reason` does not reach the wire until it passes it — expected; the
renderer derives it), `src/lib/shared/state/ledgerLines.test.ts` (fixtures at ~355 and ~379 use made-up "no clock"
sentences and will now read *not moved* — expected; report the failing names), `src/lib/server/sockets/storyClock.int.test.ts:143`,
`runtime/host.ts`, `bindings.state.ts`, `rulesets/clockHours.ts`, `NOMENCLATURE.md`.

## Out of scope (never build)

Wording by `cause` (keeper / tick) — held. Dropping a keeper move (★13a); where a keeper's refusal shows (★13b); a
dayless clock starting to count days (★13c — it still refuses; only the sentence changes). No migration: old rows are
read through `clockSkipKindOf`.

## Stop and ask (in your report) when

A name beyond `NO_STORY_CLOCK_YET` (moved), `CLOCK_SKIP_KINDS`, `ClockSkipKind`, `clockSkipKindOf` and the `reason`
fields; any other user-visible string; a migration; a file outside Files owned.

## Tests — Done means these are green

1. `ledgerLines.clockNote.test.ts` — keep both existing tests passing (the second uses `"No clock."` with no reason:
   it now reads *not moved*, so update its expectation to `/^Time passes: .*, not moved\. No clock\.$/` and say so);
   add: a `reason: "no-clock"` row → *not on the clock*; a `reason: "refused"` row → *not moved*; a row with **no**
   `reason` whose `skipped` is `NO_STORY_CLOCK_YET` → *not on the clock*, with another sentence → *not moved*; a stored
   `reason` wins over the text; `clockSkipKindOf` on an applied move (no `skipped`) is null.
2. `clockMoves.int.test.ts` — add: a skipped row written by `recordClockMove` with `NO_STORY_CLOCK_YET` stores
   `payload.reason === "no-clock"`, and one with a refusal sentence stores `"refused"`; an **old-shape row** inserted
   directly into `state_proposals` (kind `clock`, status `skipped`, payload `{ kind, by, unit, cause, skipped }` with no
   `reason`) reads back from `clockLedgerRows` with the derived `reason` (both arms). Existing tests stay green.
   DB tests get a 60 s timeout.
3. SDK `storyClockAdvance.test.ts` green.

Commands (never pipe vitest into `head`; never a full `npm test`, `npm run check`, project-wide `tsc`, or the SDK
root `npm test`/`npm run build`):

```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/shared/state/ledgerLines.clockNote.test.ts src/lib/shared/state/ledgerLines.test.ts src/lib/server/state/clockMoves.int.test.ts src/lib/server/state/clockProposal.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-A-w2-1.log 2>&1; echo exit=$?'
```
```
cd /home/jody/github/serene-pub-sdk/sdk-tests && timeout 300 npx tsx --test storyClockAdvance.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-A-w2-sdk-1.log 2>&1; echo exit=$?
```
(If `systemd-run` is refused, use `timeout 900` with the same NODE_OPTIONS. Increase the log number on each rerun.)
`ledgerLines.test.ts` and `clockProposal.int.test.ts` are run to see breakage, not to fix it (see Not yours).
Run `npx prettier --check` on each file you changed except `types.ts`; fix only lines you changed.

## Rules your work depends on (quoted by the supervisor)

- **Stored data** (CLAUDE.md): "0.6 is in users' hands. A change to stored data or ids ships with a forward migration
  or boot pass…" — an additive field is fine only if every reader still works on rows that lack it (test that).
- **Names** (NOMENCLATURE §1): R1 one word, one meaning; R3 qualify, never the bare noun. The canon row for the clock
  move (NOMENCLATURE §25 ~line 1930): payload `ClockMovePayload { kind, by, unit, cause, from?, to?, skipped? }`;
  status `skipped` = "asked, not made; kept so the ledger says why"; drawn as *Time passes: 3 hours (… → …)* /
  *Time goes back: …* / *…, not on the clock. {why}*. You add `reason`; the supervisor writes the canon rows.
- **Copy** (STYLE-GUIDE §10): "Sentence case everywhere", "errors say what went wrong and what to do", it is a
  *session*, never a *chat*. Use the exact sentences given here.
- **SDK** (CLAUDE.md): edit the SDK in `../serene-pub-sdk`; its tests run against the sources via tsconfig paths.
  "Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."
- **DB:** inside `db.transaction(async (tx) => …)` use only `tx`; never seed a row at a hardcoded id.
- **Decisions** (CLAUDE.md): "Do what was asked, at the size asked. Findings along the way go under **Noticed, not
  done**, never fixed in passing. Nothing 'for later'."

## Verbatim (multi-agent guide)

- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`: the app tests above don't read the new SDK sentence.)
- Also: never `git checkout`, `git restore` or `git clean` in either repo.

## Report (your final message)

Changed files (both repos) · each change in one line · tests run with the exact command and pass/fail counts (quote
the summary lines), listing any failures in files that are not yours by test name · anything you stopped on ·
Noticed, not done. Under 600 words.
