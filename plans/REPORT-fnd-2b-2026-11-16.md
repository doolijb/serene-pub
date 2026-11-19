# REPORT — lane `fnd-2b` (2026-11-16): `pipelines/runtime/host.ts` split by area

Supervisor's report, saved by the lead. Steps 1–5 landed in order, each green before the next. Step 6 (lore
commits) was not done: it needs edits to moved lines (below). Every move was made by a script that refuses to
write unless each moved block is byte-identical in its new file (`read` / `call` bodies dedented by their
enclosing depth; a line that starts inside a string or template literal keeps every byte) and `host.ts` changed
nowhere else.

## Steps

| Step | New file (lines) | `host.ts` after |
|---|---|---|
| 0 | — | 13,150 |
| 1 | `host.types.ts` (412; 425 with `HostReadArgs`) | 12,766 |
| 2 | `host.loreWrites.ts` (927), 24 units | 11,892 |
| 3 | `host.helpers.ts` (1,143), 39 units, holds the one `embeddingModule` cache | 10,852 |
| 4a | `host.read.lorebookEntries.ts` (896) | 9,979 |
| 4b | `host.read.sessionCast.ts` (707) | 9,301 |
| 4c | `host.read.summarize.ts` (366) | 8,963 |
| 4d | `host.read.retrieval.ts` (733): embedding_status, vector_search, entity_annotations, recalled_lines, mention_spans, entity_link | 8,283 |
| 5 | `host.call.ts` (858): the whole `call` body as `hostCall` | **7,466** |

Checks after every step: `tsc` 0 errors; the `runtime/host` export set unchanged (7 names, 4 values:
`HostScopeError, STEP_TYPES_FOR_TEST, createHost, narratorNameFor`); no value-import cycle (the old
`host` ↔ `loreSources` / `loreMatch` cycle is gone: their one import line now points at `host.types`); no
`host.*.ts` imports `host.ts`; 30 test files, 307 passed, 1 failed (the standing `allPipelines` "every provider
has a dispatch path", same as the baseline `plans/fnd-2b-0.log`).

Independent proofs against the pre-lane `host.ts`: all 68 moved top-level units appear verbatim exactly once
across the new files; rebuilding `createHost` from the original with only the 11 case / body replacements gives
today's `createHost` character for character; each moved body, dedented, is in its new file exactly once.

Final: `tsc` 0; `npm run check` 0 errors, 9 warnings (`plans/fnd-2b-check.log`).

## Decisions (inside scope)

- **Read case form.** `read<Table>({ db, scope, host, node, q }: HostReadArgs, cache?)`; the switch line is
  `return readX({ db, scope, host, node, q }[, lorebookReads | channelShaping])`.
- **Call form.** `hostCall({ db, scope, host, toolDoors }, payload, node, run, handles)`; `HostCallArgs` is local
  to `host.call.ts`.
- **Type-only imports** are written `import type` (`verbatimModuleSyntax` is on), so no new run-time edge.
- The script checked each moved case's closure names against its parameters, and that no case could fall through.

## What stays in `host.ts` and why

- The run's closure state: `liveChannel`, `liveRowId`, `turnMessageId`.
- The helpers that read it (~1,670 lines): `imprintAnchor` … `announceSettled`, the per-host caches, `record`,
  `emit`, the annex writers, `writeBlocks`, `toolDoors`.
- The rest of `read` (~1,040 lines): `session_messages`, annexes, greetings, state, graph, the small reads.
- `commit` (~4,490 lines), which includes `create-message` / `update-message`.

## Step 6 not done

`imprintAnchor`, `holdLoreEntryChange` and the lore commits (`create-lore-entry`, `update-lore-entry`,
`update-cast-member`, `link-lore-entries`, `note-scene` / `set-seat-bench`, `writeLorebookAnnexDocument`) read
`turnMessageId` live: about 10 reads. A factory would rewrite each as a getter call, which edits moved lines.
About 1,500 more lines would leave `host.ts`; it needs the lead's word on the getter edit.

## Comment ratchet

`host.ts` had no entry and every new file counts 0; `commentHistory.ratchet.json` not edited.

## Changed files

`src/lib/server/pipelines/runtime/host.ts`; 8 new `host.*.ts`; `loreSources.ts`, `loreMatch.ts` (one import line
each); `src/lib/server/pipelines/README.md` (where a new host case goes). Briefs `plans/briefs/BRIEF-fnd-2b-w1.md`,
`-w2.md`; logs `plans/fnd-2b-*.log`.

## Noticed, not done

- `prettier --check` flags the new files, as it flagged `host.ts`.
- `bindings.outlets.ts` has `import { type RenderRun } from ".../renderers"`, which still loads `renderers` at
  run time under `verbatimModuleSyntax`.
- The comment-ratchet test fails on 16 files other lanes edited (recorded 543, tree 545); in the standing list.
