# BRIEF — worker `time-t6c2-w4` (app) — the binding of `core:query/unknown-entries@1`

Supervisor: lane `time-t6c2`. App repo `/home/jody/github/serene-pub`. SDK `/home/jody/github/serene-pub-sdk`
(read only; already built). Another session shares the checkout: touch only the files below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: **do not run `sdk:build`, `sdk:test` or any vitest** — another worker is running tests and the lane runs one at
a time; the supervisor runs yours after you report. You may run `NODE_OPTIONS=--max-old-space-size=10240 npx tsc
--noEmit -p .` once at the end. Never `prettier --write`; never `git checkout / restore / stash`; never `kill -9`.
Comments state the rule, not the story. No other product's name in any file.

## Rulings this serves (quoted)

- 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not know."
  ★6: a narrator, an envoy and a step writing for several characters read everything.
- Plan §5 rule 6: "A filter always shows its cause: *not known by ‹name›*".
- 2026-11-15: "all features are opt in on invoke"; opt-in "pipeline/node". Not placed → nothing changes.
- INTEGRATING.md "Handler input types come from the contract": a handler declares what it reads with
  `reads<typeof C.x>(hook, { ports, params })`; `boot/declaredReads.ts` fails the suite where a definition declares
  an in-port no handler reads.

## What exists

- SDK (built): `C.unknownEntries` = `core:query/unknown-entries@1` (`contracts/src/queries.ts` ~1236–1305 in the SDK
  repo). In: `scope` (`S.sessionScope`), `speaker` (`S.participantRef`). Out: `main` (`Array<{ entryId, reason }>`,
  entry id order) and `exclusions` (`{ source, id, reason }` verdicts). Not optional. No params.
- App: `src/lib/server/lorebooks/entryKnowledge.ts` — read it whole. `loadEntryKnowledge(db, { sessionId, speaker })`
  → `reads-all` | `nothing-marked` | `judged { name, leftOut, notKnown, keptFrom }`; `knowledgeExclusions(leftOut,
  name)`; `knowledgeExclusionReason(cause, name)`; `knowledgeReceipt(name, judged)`; `NOTHING_MARKED_RECEIPT`.
  `readsAllReceipt()` lives in `src/lib/server/sessions/firsthandFilter.ts` (one sentence, one owner: import it).
- The pattern to copy: the `core:query/history-entries@1` binding in `src/lib/server/pipelines/runtime/bindings.ts`
  ~2843–2903 (dynamic imports of the module and of `$lib/server/db`, `ctx.log("info", …)` for the receipt, `ok(…)`).

## Files owned (only these)

1. **`src/lib/server/pipelines/runtime/bindings.ts`** — one new entry right after `core:query/history-entries@1`:
   `"core:query/unknown-entries@1": reads<typeof C.unknownEntries>(async (input, ctx) => …, { ports: ["scope",
   "speaker"] })`. Behaviour: no numeric `input.scope.sessionId` → `readsAllReceipt()` note and `ok({ main: [],
   exclusions: [] })`. Else `loadEntryKnowledge(db, { sessionId, speaker: input.speaker })`: `reads-all` →
   `readsAllReceipt()`; `nothing-marked` → `NOTHING_MARKED_RECEIPT`; both answer `{ main: [], exclusions: [] }`.
   `judged` → note `knowledgeReceipt(name, judged)`, `main` = `leftOut.map(l => ({ entryId: l.entryId, reason:
   knowledgeExclusionReason(l.cause, name) }))`, `exclusions` = `knowledgeExclusions(leftOut, name)`. A two-line
   comment stating the rule (opt-in by placing the node; its `exclusions` reach eligibility; the decision is
   `lorebooks/entryKnowledge.ts`). If a declared-reads constant is the file's pattern for a node with this port
   list, follow it; otherwise the inline `{ ports }`.
2. **`src/lib/server/pipelines/boot/declaredReads.test.ts`** — in the `speaker` test (~232–252) add that
   `core:query/unknown-entries@1` reads exactly `["scope", "speaker"]`, with a one-line comment.
3. **`src/lib/server/pipelines/boot/registryHashes.test.ts`** — add the new definition's pin in the block where
   `"core:query/entries-named@1"` sits (~1857), in the same form:
   `"core:query/unknown-entries@1": "<hash>" /* new — time-t6c2 2026-11-15 */,`. You cannot run the test to read the
   hash: put `"TBD"` and say so in the report; the supervisor fills it from the test's failure.
4. **`src/lib/server/pipelines/runtime/bindings.entryKnowledge.int.test.ts`** (new) — drive the binding through
   `coreBindings()["core:query/unknown-entries@1"]` with a real PGlite fixture (copy the setup of
   `src/lib/server/pipelines/runtime/bindings.firsthand.int.test.ts` — read it — and the fixture style of
   `src/lib/server/lorebooks/entryKnowledge.int.test.ts`). Cases: nothing marked → `{ main: [], exclusions: [] }`
   and the nothing-marked note; a marked entry the speaker is not tied to → `main` has it with *Not known by
   ‹name›.*, `exclusions` has it under `worldLore`, `characterLore` and `history`, and the note is *1 entry left
   out: not known by ‹name›*; speaker null (a narrator) → reads-all note, empty outputs; a `kept_from` tie on an
   unmarked entry → *Kept from ‹name›.*.
5. **`src/lib/server/pipelines/ranking/eligibility.entryKnowledge.test.ts`** (new, pure) — `applyEligibility`
   (`ranking/eligibility.ts`) with candidates for one left-out entry id as each mechanism brings it: a keyword
   `worldLore` candidate, a `characterLore` one, a `history` one, a vector-search `historyEntry` one, an
   entity-search one (`source: "worldLore"`, `payload.foundBy: "entity-search"`), and a pinned one; plus one
   candidate for another entry. With `exclusions: [loreLaneExclusions, knowledgeExclusions(leftOut, "Mira")]`
   (nested list, as specs wire it) every copy of the left-out entry is ineligible with *Not known by Mira.* and the
   other entry is untouched; with the knowledge list empty, the output equals the input untouched (the node placed
   with nothing to filter changes nothing). Check how a pinned entry reaches the candidates (search `pinned` /
   `constant` in `ranking/` and the lore read) and model the candidate on that; say in the report what you found.

## Out of scope

Any shipped pipeline (no spec places the node); the SDK; the decision module (report any defect in it instead of
editing it); docs; NOMENCLATURE.

## Stop and ask when

CLAUDE.md §Decisions applies; the binding needs a host read (`ctx.read`) that does not exist; a name not listed above
is needed outside your test files.

## Done means

Code and tests written; `tsc` clean in your files. The supervisor runs:
`npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/bindings.entryKnowledge.int.test.ts src/lib/server/pipelines/ranking/eligibility.entryKnowledge.test.ts src/lib/server/pipelines/boot/declaredReads.test.ts src/lib/server/pipelines/boot/registryHashes.test.ts`.

## Report

`/home/jody/github/serene-pub/plans/briefs/REPORT-time-t6c2-w4.md`: changed line ranges, how pinned entries reach
eligibility, decisions, **Noticed, not done**.
