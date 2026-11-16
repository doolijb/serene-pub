# BRIEF — `perf-N` worker 2 — measure the SDK conversation's per-frame order work (bench only)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Measure, do not optimise. While a reply streams into a widget running in a UI worker, the SDK's `componentWire.ts`
(`../serene-pub-sdk/sdk/src/componentWire.ts`, `case 'message'`) replaces the streaming row by id and **copies the
messages array** on every streamed frame (on purpose, perf-H). Everything in the conversation keyed on that array then
reruns once per frame, O(N) over the window:

- `../serene-pub-sdk/core-catalog/components/shared/messages/SessionContainer.svelte`:
  `msgOrderKey` (`:164-166`, `messages.map((m) => (m.isHidden ? \`${m.id}h\` : m.id)).join(",")`) and `laneKey`
  (`:177-181`, ``messages.map((m) => `${m.id}|${m.channel ?? ""}|${conv.isInterleaved(m) ? 1 : 0}|${anchorOf(m) ?? ""}`).join(",")``).
- `../serene-pub-sdk/core-catalog/components/shared/messages/conversation.svelte.ts`: the per-channel `rows` filter
  (`:178-194`: `rowOnListedChannels` / `isInterleavedRow`, `interleaveByAnchor`, `rowsByKind`) and the facts
  `anyGenerating` / `indexRowsById` (`:202-203`, from `rowFacts.ts`).

Write a bench that reports **ms per frame** for each of those, on a **500-row window, 50 frames**, where each frame is
what `componentWire` produces: a new array, every row the same object except the streaming row, which is a new object
with the same id, channel, `isHidden` and metadata and longer `content`.

## Shape

- New file `../serene-pub-sdk/sdk-tests/conversationOrderBench.test.ts`, `node:test` + `tsx` like its neighbours
  (read `sdk-tests/conversationRowFacts.test.ts` for imports from `../core-catalog/components/shared/messages/*.js`).
- Gate it like the app's benches: skipped unless `process.env.PERF_BENCH` is set
  (`test('…', { skip: !process.env.PERF_BENCH }, () => { … })`). Log the numbers with `console.log`.
- Import the real helpers (`rowFacts.ts`, `interleave.ts`, and wherever `rowOnListedChannels` lives — grep
  `core-catalog/components/shared/messages` and `core-catalog/src`, never `dist/`). The two keys live in a `.svelte`
  file: copy their expressions verbatim into the bench with a comment naming the file and line they mirror, and give
  `conv.isInterleaved` / `anchorOf` their real implementations (`isInterleavedRow` from `interleave.ts`; `anchorOf`
  per `SessionContainer.svelte` — read it).
- Cases: (1) default copy — channels `['main']`, no interleave, no `rowKinds`; (2) a two-channel copy (`['main','sanctum']`,
  rows split across them); (3) an interleave copy (one channel interleaved, ~10% of rows anchored via
  `metadata.anchorMessageId`). Realistic rows: `{ id, channel, role, content (~400 chars), isHidden, isGenerating,
  metadata: {...}, parts: [] }`.
- Per case and per piece (`msgOrderKey`, `laneKey`, `rows` filter, `anyGenerating`, `indexRowsById`) report: median and
  p95 ms per frame over the 50 frames, after a warm-up of 20 frames. Also the sum per frame. Run the whole thing 3 times
  and report all three.
- Also measure what an **exact shape check** would cost (the alternative the lane must judge): per frame, compare old and
  new arrays row by row for id, `channel`, `isHidden`, `metadata.anchorMessageId`, round and kind (read `rowKindOf` in
  `interleave.ts` for what "kind" and "round" read) — so the report can say whether an O(N) check saves anything over
  the keys it would skip.
- Plus one non-gated sanity test in the same file (always runs, fast): the bench's frame builder keeps every row but the
  streaming one by reference and keeps ids/order — so the bench measures the real shape.

## Run

From `/home/jody/github/serene-pub-sdk/sdk-tests`: `npx tsc --noEmit` (must stay clean for your file) and
`PERF_BENCH=1 npx tsx --test conversationOrderBench.test.ts` (3 runs), and once without `PERF_BENCH` (the bench is
skipped, the sanity test passes). Also record the machine: `nproc`, `node -v`, and `cat /proc/cpuinfo | grep "model name" | head -1`.

## Files owned (edit only this)

- new `../serene-pub-sdk/sdk-tests/conversationOrderBench.test.ts`

No edit to any SDK source file. No `sdk:build`.

## Rules (quoted from the lane brief)

- "Reuse only strings/keys, never a filtered row array" — not yours to build; the bench only measures.
- The gate: "measure on this machine and apply a ×4 factor (the standing ruling: browser code runs on phones) — so
  build nothing unless the per-frame cost here exceeds ~0.25 ms". Report the per-frame sums against 0.25 ms.
- NOMENCLATURE §24/§25 for any new name — you add none.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You run no `sdk:build`.)

Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`.

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD.

## Stop and ask when

CLAUDE.md §Decisions applies; you would need to edit any other file; the real helpers cannot be imported from source.

## Done means

The bench file; `tsc` clean in `sdk-tests` for it; the three PERF_BENCH runs' numbers; the sanity test passing; prettier
`--check` on the new file (if the SDK has a prettier config that applies; say if none does).

## Report

Final message: the file; the machine; a table per case × piece (median / p95 ms per frame, 3 runs); the per-frame sum vs
the 0.25 ms gate; the O(N) shape check's cost vs the keys it would skip. Nothing written to disk as a report.
