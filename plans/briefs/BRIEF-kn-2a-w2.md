# BRIEF — kn-2a worker 2: the knowledge filter at the source (host lore read + the three lore lanes)

Supervisor: lane `kn-2a`. Report back as your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout / restore / stash` in either repo; never `prettier --write`; you do not need `sdk:build` (the SDK is already built with the param). Other lanes edit other files in this repo at the same time: edit only the files below, with small targeted edits (re-read a file right before you edit it; no whole-file rewrites of a file you did not create).

## Rules this work depends on (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "Never add a top-level `await` to `src/lib/server/db/index.ts`." · "It is a **session**, never a *chat*." · Comments state the rule, not the story; no other product's name anywhere.
- P1 (owner): "Deterministic, never hidden. … every automatic action shows its cause and how to undo or switch it off." → every read that drops rows logs a receipt note saying how many and why.
- Owner 2026-11-15: the toggle is "on by default, that way a modder can disable it", "in the query markup". The SDK now declares 🚧 `knownToSpeaker` (boolean, default `true`) in the `params` slot of world-lore, character-lore, history-entries, lorebook-triggers, lorebook-entries, vector-search, entity-search, entity-link, relationship-search, entries-named (built: `../serene-pub-sdk/contracts/src/queries.ts`). Only an explicit `false` turns it off.
- The rule (`lorebooks/entryKnowledge.ts`, unchanged by you except where stated): an entry marked *not common knowledge* is left out unless the speaker has a knowledge tie to it; an entry a *kept from* tie wins for is left out, marked or not. A run that speaks as nobody reads everything.
- **No new names** beyond those listed in this brief; no new receipt sentences: reuse `knowledgeReceipt`, `NOTHING_MARKED_RECEIPT`, `readsAllReceipt` (in `sessions/firsthandFilter.ts`: import it, never edit that file).

## Files owned (app repo `/home/jody/github/serene-pub`, under `src/lib/server/`)

- `lorebooks/entryKnowledge.ts`
- `pipelines/runtime/host.read.lorebookEntries.ts`
- `pipelines/runtime/bindings.retrieval.ts` — **only** `loreFor` (and `LANE_READS`) plus the file's header comment (line 3 still names "unknown entries"; the supervisor already removed the `unknown-entries` binding). Do not touch the `firsthand…` block in the history-entries lane, nor any other binding (triggers, listing, vector, entity: the next worker's).
- Tests: `pipelines/runtime/bindings.entryKnowledge.int.test.ts` (rewrite), `pipelines/ranking/eligibility.entryKnowledge.test.ts` (delete: it tests the removed `knowledgeExclusions`), `lorebooks/entryKnowledge.test.ts` (only if it imports something you remove), `pipelines/boot/declaredReads.test.ts` (the lanes' declared reads and the removed `unknown-entries` row, ~243–252), and in the two prompt-baseline tests only the receipt helper and case b: `pipelines/runtime/unknownEntries.reply.int.test.ts`, `sockets/sessions.lairUnknownEntries.int.test.ts` (**do not** change anything else in those two; leave the `kn2Note` lines alone).

**Not yours:** `host.ts`, `bindingTypes.ts`, `sessions/firsthandFilter.ts`, `sockets/sessions.ts` and every `sockets/sessions.*.ts` other than the one test named above, any SDK file, docs, NOMENCLATURE.

## Design (decided by the supervisor; build it this way)

1. **Where the drop happens: the host's `lorebook_entries` read** (`readLorebookEntries`). It already resolves the speaker subject (`speaker = loreVisibilitySubject(…)`, `{ card, member }`, ~line 115) and has the per-run memo map `lorebookReads` (one host serves one run; "freed" with the host). When the query carries `knownToSpeaker === true` (a literal `true`; absent or anything else = no knowledge filter, so every other caller reads exactly as today):
   - Speaker ref: `member != null` → `seated-member:${member}`; else `card != null && card !== NO_SUCH_CHARACTER` → `character:${card}`; else none. None → no filter, and the drop says `reads-all`.
   - Load once per run and speaker: memo key `knowledge:${sessionId}:${ref}` in `lorebookReads`, value the promise of `loadEntryKnowledge(db, { sessionId, speaker: ref })`; on rejection delete the key (as the scan memo does, `scanned.catch(() => scans.delete(scanKey))`). Note `seatOf` answers null for a card that sits in no seat (Story's side character): that run reads everything, keep it.
   - Drop from `out` (after the union, before `withLinks`) every row whose `id` is in the judgement's `leftOut`. In the `withLinks` block, an entry in `leftOut` is unseen as a far end too (`seen` must not contain it), so no listed row's link names it.
   - Record what this read dropped on the returned array through a module-level `WeakMap` side channel in `entryKnowledge.ts` (below). Return that same array object.
2. **`entryKnowledge.ts` additions** (🚧 each; JSDoc one or two lines):
   - `type KnowledgeDrop = { kind: "reads-all" } | { kind: "nothing-marked" } | { kind: "judged"; name: string; notKnown: number; keptFrom: number; leftOutIds: number[] }` where `notKnown` / `keptFrom` count the rows **this read** dropped by cause, and `leftOutIds` is the judgement's whole left-out list (the next worker needs it for reads that do not go through this host read).
   - `noteKnowledgeDrop(rows: object, drop: KnowledgeDrop): void` and `knowledgeDropOf(rows: unknown): KnowledgeDrop | undefined` over one module-level `WeakMap`.
   - `knowledgeDropReceipt(drop: KnowledgeDrop): string` → `readsAllReceipt()` / `NOTHING_MARKED_RECEIPT` / `knowledgeReceipt(name, { notKnown, keptFrom })`.
   - Remove `KNOWLEDGE_SOURCES`, `knowledgeExclusions` and, if nothing else uses it (`grep -rn` the app), `knowledgeExclusionReason`. Update the module JSDoc's rule 4 and "Does not own" so they describe the reads' param instead of exclusions.
   - Leave room, but build nothing, for the next worker's standing-place exception (it will drop the entry the speaker stands in from `leftOut` inside `loadEntryKnowledge`).
3. **The three lanes** (`loreFor`): pass `knownToSpeaker: input?.params?.knownToSpeaker !== false` in its `ctx.read("lorebook_entries", …)` query; after the read, when the param is on, `ctx.log("info", knowledgeDropReceipt(drop))` with `drop = knowledgeDropOf(entries)` (skip the log when undefined). Add `"knownToSpeaker"` to `LANE_READS.params` (it is `satisfies TypedReads<…>`: it type-checks only because the SDK declares it on all three).
4. **Prompts must not change for the same data.** Before any code change the supervisor captured each case's prompt sha (`plans/kn-2-shas-before.txt`). The filter used to act at eligibility; now the entry never enters the scan. Run the two baseline tests with `KN2_SHA_LOG=/home/jody/github/serene-pub/plans/kn-2-shas-w2.txt` and compare **every** line with the before file. A sha that differs is a finding: find where the two prompts part (`firstDifference` in the test), report it, and do not "fix" it by changing the tests' data.

## Tests

- `bindings.entryKnowledge.int.test.ts` (rewrite; keep its world-building helpers if useful): through the real bindings and host read, for each of world-lore, character-lore (a character-lore entry the speaker may see), history-entries: a marked, untied entry is absent with the default; present with `params: { knownToSpeaker: false }`; present for a run with no speaker (scope `currentCharacterId: null`, no `currentCastMemberId`); absent for a card-less seat's turn (scope `currentCastMemberId`); present again once tied (`writeKnowledgeTie`, kind `knows`); a *kept from* entry absent unmarked. The receipt note (`ctx.log`) says the count. A one-load test: two lanes in one run → `loadEntryKnowledge` runs once (spy, or statement count as `firsthandFilter.int.test.ts` counts them).
- The two baseline tests: case b now reads the receipt notes of the lore-lane nodes of that run (find their node keys on the receipt), expecting `NOTHING_MARKED_RECEIPT`; rename its helper accordingly. Everything else in those files stays.
- `declaredReads.test.ts`: the three lanes read `knownToSpeaker`; the `unknown-entries` row goes.
- Run, one at a time, only in this capped form, after waiting for no vitest:
  `until ! ps -eo pid,args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 20; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-2-w2-<n>.log 2>&1"`
  Never pipe vitest into `head`. Files: the rewritten test, `lorebooks/entryKnowledge.test.ts`, `entryKnowledge.int.test.ts` (same dir), `declaredReads.test.ts`, the two baseline tests (with `KN2_SHA_LOG`), `pipelines/runtime/host.loreMatchShown.int.test.ts`, and any test under `pipelines/runtime/` whose name contains `lorebookEntries`, `withLinks`, `loreLanes` or `characterLore` (`ls src/lib/server/pipelines/runtime | grep -i …`).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report errors in your files only (other lanes may have their own).

## Stop and ask (in your report) when

A baseline sha differs; the speaker cannot be resolved for a read the way item 1 says; a design point above does not fit the code as it stands; anything needs a file you do not own or a new name not listed here.

## Report

Changed files; the design as built (anything you did differently and why); each test file with pass/fail; the before/after sha table; statement counts (before file vs yours, second-world numbers); tsc result; anything noticed and not done.
