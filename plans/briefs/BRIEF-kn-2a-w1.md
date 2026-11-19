# BRIEF — kn-2a worker 1: the SDK half (the `knownToSpeaker` param declared; `unknown-entries` removed)

Supervisor: lane `kn-2a`. Report back as your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout / restore / stash` in `/home/jody/github/serene-pub-sdk` (most of it is uncommitted, much of it other sessions' work: leave every file you do not own exactly as it is). Never `prettier --write`.

## Goal

Owner, 2026-11-15: "When querying on a characters history/knowledge, have it be a toggle that's on by default, that way a modder can disable it if they want to do somethign custom. Since it's an SDK built-in, I'm thinking it should be in the query markup, not in the helper tooling that core genres use."

So the knowledge filter moves from an opt-in node (`core:query/unknown-entries@1`, placed by Story and the Lair) into a **param on every read that returns lore entries**: 🚧 `knownToSpeaker` (boolean, default `true`). The app side (another worker) makes each read drop, at the source, every entry the speaking character does not know. Your half: declare the param, remove the old node and its wiring, keep the SDK suite green.

## Files owned (SDK repo `/home/jody/github/serene-pub-sdk`)

- `contracts/src/queries.ts`
- wherever `unknownEntries` is exported or registered in the catalog (find it: `grep -rn "unknownEntries" contracts/src sdk/src core-catalog/src`) — remove only those references
- `core-catalog/src/genres/story/respond.ts`, `core-catalog/src/genres/lair/reply.ts`
- `sdk/src/validate.ts` (one law block only, below)
- `sdk-tests/unknownEntries.test.ts` (replace), `sdk-tests/lair.test.ts`, `sdk-tests/coreCatalog.test.ts`, any `sdk-tests/nodeInput*.test.ts` that breaks, any other sdk-test that pins a hash these changes move

**Not yours:** `INTEGRATING.md`, `guides/*.md` (a later docs step), anything about `firsthandFor` / `firsthandBy` (another lane: leave those in-ports, their JSDoc and their `validate()` law **exactly** as they are), any app file.

## Work

1. **Declare the param** in the `params` slot schema of each of these reads (`contracts/src/queries.ts`):
   `core:query/world-lore@1`, `character-lore@1`, `history-entries@1` (all three take their schema from `loreSlots()`, ~line 1042; add it there, **not** `shared`: each node reads its own),
   `lorebook-triggers@1`, `lorebook-entries@1`, `vector-search@1`, `entity-search@1`, `entity-link@1`, `relationship-search@1`, `entries-named@1`.
   If one of them has no `params` slot at all, do not add a slot: stop on that read and report it.
   Not on `mention-spans@1` (it returns spans of message text, no entry), not on `relationships-known@1` / `relationships-perspectives@1` (cast-to-cast ties only), not on `turn-plan@1`.

   Shape, copied from `lorebook-entries`' `withLinks` (~line 4086):
   ```ts
   /**
    * 🚧 (kn-2a, 2026-11-16; name provisional) <one or two lines: the rule, below>.
    */
   knownToSpeaker: {
   	type: 'boolean',
   	default: true,
   	label: { en: 'Only what the speaker knows' },
   	description:
   		'Leaves out the entries the speaking character does not know (marked not common knowledge with no knowledge tie to it, or kept from it; the place it stands in always counts as known), and does nothing on a turn no single character speaks, such as the narrator’s.',
   },
   ```
   The description is **one sentence**; on `relationship-search@1` say "the entries … and the links that lead to them"; on `lorebook-entries@1` say "the entries … and the links that name them". Same label everywhere. Comments state the rule, not the story; no other product's name anywhere.

   The rule (for the JSDoc): an entry marked *not common knowledge* is left out unless the speaker has a knowledge tie to it (any active tie from its cast binding that reads on the reply's line at the reply's date and is not *kept from*), or it is the place the speaker stands in; an entry a *kept from* tie wins for is left out, marked or not. The speaker is the read's own `speaker` in-port when wired, else the character the run speaks as (`scope`); a run that speaks as nobody (narrator's turn, routine, action, envoy, a step writing for several characters) has no speaker and the read returns everything. `false` turns it off for that node.

2. **Remove `core:query/unknown-entries@1`**: the `unknownEntries` contract (~1240–1320, its whole JSDoc), its export/registration. Then fix every JSDoc in `queries.ts` that points at it (e.g. the `history-entries` / `lorebook-entries` "Limit:" notes; `grep -n "unknown-entries\|unknownEntries\|Entries not known" contracts/src/queries.ts`) so it states the new rule instead. Do not touch the `firsthandFor` / `firsthandBy` text.

3. **Story** `core-catalog/src/genres/story/respond.ts`: remove the `.chain('unknownEntries', …)` (~757–764) and `$.gather.unknownEntries.read.exclusions` from the eligibility `exclusions` list (~1015–1020). **Lair** `core-catalog/src/genres/lair/reply.ts`: remove the `.query('unknownEntries', …)` in `voiceBranch` (~420–426) and its exclusions in that branch's `eligible` (~478–483). Leave surrounding comments true (rewrite a comment that described the removed node; one line: the lore reads leave out what the speaker does not know by default). No other change to either spec.

4. **validate.ts**: delete the `// ── entry knowledge — the verdicts reach eligibility` block (~1390–1411, law `'entry knowledge 2026-11-15'`). The `firsthand 2026-11-15` block above it stays byte-identical.

5. **Sweep, report only (change nothing):** in `core-catalog/src/genres/**`, list every node of the ten reads above that runs inside a run that has a speaking character but whose output is used by a step that does not write as that character (for example a narrator-voiced or `sweep` step inside a character's reply run). Give file:line, the run it is in, and why. Also list where Chat (`chat/respond.ts`, `chat/memory.ts`) and Guide (`guide/respond.ts`) place these reads.

6. **Build and test.**
   - Before `npm run sdk:build` (run it **from the app root** `/home/jody/github/serene-pub`): `pgrep -af "vite (dev|preview)"` must show no serene-pub server (else stop: "blocked on your dev server"); then wait until no vitest runs, with a loop, not a blind sleep, and start the build immediately after:
     `until [ -f plans/kn-2-baseline.done ] && ! ps -eo pid,args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 20; done; npm run sdk:build > plans/kn-2-w1-build.log 2>&1; echo $?`
     (`plans/kn-2-baseline.done` is the supervisor's marker that a before-change test run has finished; the build must not swap the dist under it.)
   - Targeted SDK tests only: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <files> > /home/jody/github/serene-pub/plans/kn-2-w1-sdk.log 2>&1` and `npx tsc --noEmit -p /home/jody/github/serene-pub-sdk/sdk-tests`. Never the whole suite.
   - `sdk-tests/unknownEntries.test.ts`: replace with `sdk-tests/knownToSpeaker.test.ts`: each of the ten reads declares `knownToSpeaker` as `{ type: 'boolean', default: true }` with a non-empty label and description; `core:query/unknown-entries@1` is not in the catalog; `mention-spans@1` does not declare it. Delete the old file.
   - Re-pin moved hashes/digests (`lair.test.ts` ~224 stub entry for unknown-entries goes; ~792 pin; `coreCatalog.test.ts` ~1077 digest; any other that moves) with a comment `Moved 2026-11-16 (kn-2a): <why> (was <old>)`. A pin that moves for a reason you cannot explain is a finding: report it, do not re-pin it.
   - Run: `knownToSpeaker.test.ts`, `lair.test.ts`, `coreCatalog.test.ts`, `firsthand.test.ts`, `nodeInput*.test.ts`, and any test file that greps for a name you changed (`grep -ln "worldLore\|lorebookEntries\|relationshipSearch\|entriesNamed\|vectorSearch\|entitySearch\|entityLink\|lorebookTriggers" sdk-tests/*.test.ts` — run the ones that pin descriptors or hashes).

## Stop and ask (in your report, then stop that item) when

A read has no `params` slot; a pin moves that you cannot explain; removing `unknownEntries` breaks something outside the files above; any new name other than `knownToSpeaker` and its label seems needed.

## Report

Changed files; for each of the ten reads the line where the param sits; the sweep list (item 5); build result; each test file run with pass/fail counts; every re-pin with old → new; anything noticed and not done.
