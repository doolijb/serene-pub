# BRIEF — worker `time-t6c1-w3` (app half 2) — the History-entries binding calls the firsthand decision

Supervisor: lane `time-t6c1`. App repo `/home/jody/github/serene-pub`. Another session shares this checkout: touch
only the files below. The SDK is already built with the new ports (16:19 today).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never run `sdk:build` (not needed; the supervisor owns it). Never `prettier --write`. Never `git checkout /
restore / stash`. Never `kill -9`. Never pipe vitest into `head`. No dev server, no model server.

## Goal

`core:query/history-entries@1` now declares two opt-in in-ports, `firsthandFor` (`S.rowIds`) and `firsthandBy`
(`S.text`) (SDK `contracts/src/queries.ts` ~1177–1230). Make its binding call the decision in
`src/lib/server/sessions/firsthandFilter.ts` (read its top comment and `loadFirsthandView`, `leftOutEntryIds`,
`historyReceipt`, `historyExclusionReason`, `readsAllReceipt`) and publish the left-out History entries on the
lane's existing **`exclusions`** out-port.

Owner rulings (quote, don't change): 2026-11-14 "Unknown content is left out of the prompt; the model is never
told what a character does not know." ★6: a narrator or envoy reads everything. 2026-11-15 "Not so much a seperate
history, but a per character filter on what gets put into their context." P1: off until invoked; the cause shown.

## Why `exclusions` (read this before coding)

History entries reach the reply as ranked lore by three mechanisms: this keyword lane, entity search (pools every
enabled entry, History rows labelled `source: "history"`) and vector search (`source: "historyEntry"`). All three
are concatenated and pass `core:task/eligibility@1`, which takes the lanes' `exclusions` (`{ source, id, reason }`)
and marks any candidate they name ineligible — the vector spelling is aliased (`pipelines/ranking/eligibility.ts`
~78–84) — and the ranker records it as `excluded_ineligible` with the sentence. Every shipped spec that reads this
lane wires its `exclusions` into eligibility (story `respond.ts` ~1006–1010; lair). So: **publish each left-out
entry on `exclusions`; leave `main`, `hits` and `skipped` exactly as they are** (eligibility then records the
keyword copy too, which shows the cause per entry).

## Build

In `src/lib/server/pipelines/runtime/bindings.ts` (only these spots):

1. The binding `"core:query/history-entries@1"` (~2833–2839) today returns `await loreFor("history", input, ctx)`.
   Keep `loreFor` untouched. After it, **only when `input` is an object and `"firsthandFor" in input`** (the port is
   wired: its key is present even when the value is null — a narrator's turn), mirror the session-history binding's
   firsthand block (~2578–2627) and the earlier-scenes one (~8740–8772):
   - `sessionId = input?.scope?.sessionId`; not a number → reads-all.
   - `by` = trimmed `input.firsthandBy` string or null.
   - dynamic imports of `$lib/server/sessions/firsthandFilter` and `$lib/server/db` as those bindings do.
   - `loadFirsthandView(db, { sessionId, characterId: input.firsthandFor, castMemberId:
     input?.scope?.currentCastMemberId, slotId: by, judgeHistoryEntries: true })`.
   - reads-all → `ctx.log("info", readsAllReceipt())`, output unchanged.
   - viewpoint → `ids = leftOutEntryIds(view)`; append to the result's `exclusions` one
     `{ source: "history", id, reason: historyExclusionReason(view) }` per id (after the lane's own verdicts);
     `ctx.log("info", historyReceipt(view, ids.length))`. Everything else in the result is unchanged.
   - If `loreFor` returned something that is not an ok result (a halt/error), return it untouched. Read how `ok(...)`
     results are shaped in this file before touching one; do not change `ok`.
   - A short comment stating the rule (as the two sibling bindings' comments do): invoked only when wired; published
     on `exclusions` so eligibility blocks every copy; the decision is `sessions/firsthandFilter.ts`.
2. Its declared reads: today `LANE_READS` (~984–990, typed against the three lanes' intersection). Add a
   `HISTORY_LANE_READS` beside `CHARACTER_LANE_READS` (~1001–1004), same pattern: ports `[...LANE_READS.ports,
   "firsthandFor", "firsthandBy"]`, params `LANE_READS.params`, `satisfies TypedReads<typeof C.historyEntries>`, with
   a two-line comment; use it on the history binding.
3. Nothing else in `bindings.ts`.

`src/lib/server/pipelines/boot/registryHashes.test.ts`: re-pin `"core:query/history-entries@1"` (line ~905) to the
new hash the test reports, with a trailing comment in the style of line 784:
`// 2026-11-15 time-t6c1: firsthandFor/firsthandBy in-ports added (was "1403d2cf364be7")`. Re-pin nothing else; if
another pin fails, report it (don't touch it).

## Tests — extend `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts` (read it whole first)

A new `describe("core:query/history-entries@1 with firsthandFor", …)` with a fixture that has History entries
(real `lorebook_entries` rows of the history type, `HISTORY_TYPE_ID` in `utils/lorebookEntries`; see how
`src/lib/server/sessions/firsthandFilter.int.test.ts` builds them, ids from inserts, never hardcoded) and scenes of
this session with `history_entry_id` set:
- not invoked: output deep-equal to the call without the port (**byte-identical**: compare `JSON.stringify` of the
  whole result) and no receipt line;
- an entry whose this-session scenes the member was all there for → not in `exclusions`;
- an entry with a missed scene → in `exclusions` as `{ source: "history", id, reason }` with the exact reason;
  `main` / `hits` unchanged from the unwired call;
- a **mixed** entry (a missed scene of this session plus a scene of another session) → in `exclusions`;
- an entry with no scene of this session → not in `exclusions`;
- a narrator turn (`firsthandFor` null, no member in scope) → reads all, `exclusions` unchanged, receipt
  `Reads everything: not one cast member's turn`;
- the receipt line (`1 history entry left out: … was not there for all of its scenes`, or the plural);
- eligibility: feed the binding's `exclusions` and a candidate `{ source: "historyEntry", id: <left-out id>, … }`
  (a vector-search copy) to the eligibility function in `pipelines/ranking/eligibility.ts` and assert it comes back
  ineligible with the reason (find its exported entry point; build the smallest valid input);
- statements: extend the existing "statements the two bindings add per reply" test (or add one beside it) — not
  invoked: 0; invoked with no slot: the number (report it).
Use 60 s timeouts on any `it` that opens a DB, as the file does.

## Rules (quoted)

- "Comments state the rule, not the story. Published prose says 'was there for', never *witness*."
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`". The binding reads on the plain `db`.
- It is a **session**, never a *chat*. No other product's name.
- No new name beyond `HISTORY_LANE_READS`. If another seems needed, stop and report.

## Tests: how to run (strictly one vitest run at a time)

First `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if a run is up, don't start yours (do other work and
check again). From `/home/jody/github/serene-pub`:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts src/lib/server/pipelines/boot/registryHashes.test.ts src/lib/server/pipelines/boot/declaredReads.test.ts src/lib/server/pipelines/boot/paramsSlotWiring.test.ts > plans/time-t6c1-w3-vitest.log 2>&1"`

then read the log. Known baseline: 2 failures in `paramsSlotWiring.test.ts` on `core:spec/speak-message` (not this
lane) — report any other. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and report errors.

## Files owned (only these)

`src/lib/server/pipelines/runtime/bindings.ts` (the spots above), `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts`,
`src/lib/server/pipelines/boot/registryHashes.test.ts` (one re-pin).

## Stop and ask (in your report, without choosing) when

`loreFor`'s result can't be extended without changing `loreFor`; the eligibility function can't be reached from a
test without editing it; a migration or a new name seems needed; anything outside the files above.

## Done means

Edits above; the four test files green apart from the known baseline; tsc 0 errors; `npx prettier --check` results.
Report as your final message: changed files with line ranges, tests with counts, the new hash, the statement
number, anything noticed but not done.
