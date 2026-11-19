# BRIEF — kn-2a worker 3: the knowledge param on the remaining reads (the leaks) + the standing-place exception

Supervisor: lane `kn-2a`. Report back as your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout / restore / stash` in either repo; never `prettier --write`; you need no `sdk:build` (the SDK is built). Other lanes edit other files at the same time: edit only the files below, with small targeted edits (re-read right before editing; no whole-file rewrites of files you did not create).

## Rules this work depends on (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." · "It is a **session**, never a *chat*." · Comments state the rule, not the story; no other product's name anywhere. · Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- P1: every automatic action shows its cause → each read that drops rows logs a receipt note (`ctx.log("info", knowledgeDropReceipt(drop))`), the way the three lore lanes now do in `loreFor`.
- Owner 2026-11-15: the knowledge filter is a param "on by default, that way a modder can disable it", "in the query markup". The SDK declares 🚧 `knownToSpeaker` (boolean, default `true`) on: world-lore, character-lore, history-entries (done by worker 2), **lorebook-triggers, lorebook-entries, vector-search, entity-search, entity-link, relationship-search, entries-named (yours)**. Only an explicit `false` turns it off.
- Owner 2026-11-15 (plan ~315): "the place a character stands in counts as known": "Yes, add it to the plan." → the standing-place exception below, new code, with a test.
- No new names beyond those in this brief; no new receipt sentences.

## What is already built (read it first)

- `src/lib/server/lorebooks/entryKnowledge.ts`: `loadEntryKnowledge` (the judgement), and worker 2's `KnowledgeDrop`, `noteKnowledgeDrop`, `knowledgeDropOf`, `knowledgeDropReceipt` (WeakMap side channel; `leftOutIds` is the judgement's whole left-out list).
- `src/lib/server/pipelines/runtime/host.read.lorebookEntries.ts` ~812–862: with `q.knownToSpeaker === true` the host's `lorebook_entries` read drops every row the speaker does not know (judged once per run and speaker, memo key `knowledge:${sessionId}:${ref}` in the per-run `lorebookReads` map), leaves those entries unseen as `withLinks` far ends, and notes the drop on the returned array.
- `loreFor` in `bindings.retrieval.ts`: the pattern to copy (pass `knownToSpeaker: input?.params?.knownToSpeaker !== false`; log the receipt when on; add `"knownToSpeaker"` to the binding's declared reads).

## Files owned (app, under `src/lib/server/`)

- `pipelines/runtime/bindings.retrieval.ts`: the bindings `lorebook-entries`, `lorebook-triggers`, `vector-search`, `entity-search`, `entity-link` and their `*_READS` declarations. Not `loreFor`, not the history-entries `firsthand…` block.
- `pipelines/runtime/bindings.relationships.ts` (`chosenEntryIds` and the relationship-search binding).
- `pipelines/runtime/bindings.outlets.ts`: **only** the `entries-named` binding (~284). Not `earlier-scenes` (another lane's).
- `pipelines/runtime/loreMatch.ts` (`entriesNamedIn`).
- `lorebooks/entryKnowledge.ts` (the standing-place exception only).
- `pipelines/runtime/host.read.lorebookEntries.ts` only if a read needs it (say why).
- `pipelines/ranking/keywordQuery.ts` only if recursion still scans a dropped entry (it should not: the pool no longer holds it).
- Tests: new or existing tests beside these files (`bindings.relationships.linkHop.test.ts`, `lorebookEntries.withLinks.int.test.ts`, `loreMatch.entriesNamed.int.test.ts`, `bindings.entryKnowledge.int.test.ts` — add, never weaken), `pipelines/boot/declaredReads.test.ts` (it now fails only because these seven reads declare `knownToSpeaker` and do not read it yet; make it pass by reading it).

**Not yours:** `host.ts`, `bindingTypes.ts`, `sessions/firsthandFilter.ts`, `bindings.ts`, any `sockets/sessions*.ts`, the SDK, docs, NOMENCLATURE.

## Work

1. **lorebook-triggers**: pass the param into its `lorebook_entries` read; receipt; `TRIGGER_READS` declares it. An unknown entry then neither triggers nor is scanned in recursion (`keywordQuery.ts` ~401, 676–700). Test: `maxRecursionDepth: 1`; a known entry that fires names an unknown entry's key and that unknown entry's own text names a third entry's key → neither the unknown nor the third is admitted; with the param `false` both are.
2. **lorebook-entries** (the place listing and its ways, `withLinks`): pass the param; receipt; declared. Test: an unknown room is not listed and no listed room's `links` names it; with `false` it is.
3. **vector-search** (~1103) and **entity-search** (~1500): pass the param into the `lorebook_entries` read each already makes (that read is their visibility gate: a hit with no lore row is withheld). Confirm, with a test or by reading the code, that a hit of each lore source (`worldLore`, `characterLore`, `history` / `historyEntry`) whose entry was dropped is not published. Receipt; declared. Recalled lines (entity-search's `messages`) are not touched.
4. **entity-link** (~1975–2000): today it reads `lorebook_entries` only when `speaker` is wired. With the param on, read it also when unwired (scope's speaker) with `knownToSpeaker: true`, and skip pool candidates not in it; with the param `false`, behave exactly as today. Receipt; declared.
5. **relationship-search** (`chosenEntryIds` ~132–176): its `lorebook_entries` read passes the param **and** `currentCastMemberId` from scope when set (today it passes only `currentCharacterId`, so a card-less seat's hop was judged as nobody). The hop then never arrives at, nor names, an unknown entry (`chosen` and `visible` both come from that read; a link whose far end is unknown is dropped by `mayShow`). Receipt; declared. The `graph_relationships` read (~337) passes only `currentCharacterId` too, but its card-less handling lives in `host.ts` (not yours): report it, do not change it.
6. **entries-named** (`bindings.outlets.ts` ~284 → `entriesNamedIn`): the binding reads directly from the db, not through the host read. Get the speaker's judgement through the host read so it is the same per-run load: when the param is on, `ctx.read("lorebook_entries", { sessionId, currentCharacterId, currentCastMemberId (when set), entryTypes: <the typeIds it already uses>, limit: 1, knownToSpeaker: true })` — read for its judgement alone, comment it so — and take `knowledgeDropOf(rows)`; when `judged`, pass `leaveOut` (the left-out entry ids) to `entriesNamedIn` (new optional option), which skips those entries before matching, so neither their text nor their name is returned. To count by cause, change the drop's `leftOutIds: number[]` to `leftOut: Array<{ entryId: number; cause: KnowledgeCause }>` (the judgement's list; update the host read and worker 2's tests that read it); `entriesNamedIn` reports which ids it skipped, and the binding logs `knowledgeDropReceipt` of a drop with this read's own counts. Declared. Test: a marked untied entry named in the messages is not returned; with `false` it is; for a run with no speaker it is.
7. **The standing-place exception** (`loadEntryKnowledge`): after judging, and only when `leftOut` is non-empty, read the speaker's place: the value of `core:slot/location@1` (SDK `HOST_PLACE_SLOT_ID`) on the speaker's cast owner (the seat's state owner: see `state/owners.ts` `castOwnerOf` and how `sessions/seats.ts` `seatOf` describes the seat), falling back to the session's own (world) value when the cast owner has none — use `state/resolve.ts` `valueOf`. Find how the Lair and Story store it (an entry reference `{ entryId }` — `isSlotLoreRef` — or a name): an entry reference removes that entry from `leftOut`; if they store a name, match it to a left-out entry by `sameName` (SDK) and say so. Recount `notKnown` / `keptFrom`. The standing place counts as known even against a *kept from* tie (you are standing in it): state that in the module JSDoc's rule. Test: a delver whose location is a marked room it has no tie to still gets that room in the place listing (`lorebook-entries`) and in a lore lane; a second marked room it does not stand in stays out. Statement cost: zero extra when nothing is left out.
8. **Do not build** (report only): `turn-plan@1`'s `locationPassage` is prose a narrator step found for the room the party are heading into, with no entry id stored beside it; say whether any entry id is reachable from the stored turn plan (`metadata.turnPlan`). `relationships-known@1` / `relationships-perspectives@1`: confirm they carry cast-to-cast ties only (`utils/graphContextFormatter.ts` `castEdgeOnly`), so no entry end can appear. `mention-spans@1` returns message text spans only.

## Tests

- Per read above: absent with the default, present with `false`, present for a run with no speaker; one card-less-seat case (scope `currentCastMemberId`) on at least the hop and one other read; the hop and `withLinks` never name an unknown entry; triggers recursion never scans one; the standing-place exception.
- The two prompt baselines must return to the pre-change prompts: run `pipelines/runtime/unknownEntries.reply.int.test.ts` and `sockets/sessions.lairUnknownEntries.int.test.ts` with `KN2_SHA_LOG=/home/jody/github/serene-pub/plans/kn-2-shas-w3.txt` and compare every line with `plans/kn-2-shas-before.txt` (case c must equal its before sha again; statement counts within a few of before). A difference is a finding: locate where the prompts part, report it, do not change the tests' data.
- Run, one at a time, only in this capped form, after waiting for no vitest:
  `until ! ps -eo pid,args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 20; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-2-w3-<n>.log 2>&1"`
  Never pipe vitest into `head`. Run every test file you touched or added, `declaredReads.test.ts`, the two baselines, and every existing test beside the bindings you changed whose name mentions `vectorSearch`, `entitySearch`, `entityLink`, `lorebookTriggers`, `triggers`, `linkHop`, `relationshipSearch`, `withLinks`, `entriesNamed`, `recursion` (`ls src/lib/server/pipelines/runtime src/lib/server/pipelines/ranking | grep -i …`).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — errors in your files only.

## Stop and ask (in your report) when

A baseline sha differs; a read cannot learn the speaker from `scope` or a port; the place value is stored in a way item 7 does not cover; anything needs a file you do not own or a name not listed here; a change would alter what a shipped genre's player sees beyond leaving out unknown entries.

## Report

Changed files; per read: what the param drops and where (file:line); the standing-place exception as built (owner, slot, value form, statements); item 8 findings; each test file with pass/fail; the before/after sha + statement table; tsc; noticed, not done.
