# REPORT — build lane `lore-match` — a lore write shown the entry updates it (2026-11-13)

Brief: `plans/briefs/BRIEF-lore-match.md`. Owner rulings: "Let the model rewrite it"; "Two builds: updates first,
children next". The lane's supervisor went quiet before its SDK rebuild; worker 2 reported
(`plans/REPORT-lore-match-w2-2026-11-13.md`), worker 1's SDK half was in the tree, worker 3 never started. The lead
finished from the tree: rebuild, pins, the two end-to-end tests, the measurement, this report.

**Nothing was looked at in a running app.**

## The rule as built

- **Read.** Before the Story sweep's `lore` and `cast` duties and Chat's *Remember things* ask the model, the new
  🚧 `core:query/entries-named@1` lists the entries the session already reads whose name or key term appears as
  whole words in the lines the step read: the session's own book first, then the attached lorebook, each as the
  session reads it (held changes included; switched-off, archived and unseen left out). At most 12 entries, within
  20% of the write's context window; an entry too long is left out whole and the next still tried. No model.
- **Shown.** 🚧 `core:script/entries-named-brief` lays them under the step's brief as `Already kept:` and one
  `- {"name","content"}` line each (a person's entry is marked). With nothing named, or the duties off, the brief
  is unchanged byte for byte.
- **Write.** `core:outlet/create-lore-entry@1` gained an optional in-port `shown` (the ids shown). With `shown` and
  `match: { name }`:
  - one entry of the name that was shown → its text is replaced, its own name kept;
  - one entry of the name that was not shown → it keeps its text and the answer is added as a new paragraph;
  - the answer says what the entry already says → nothing is written;
  - two or more of the name → nothing is written for that item, the run goes on, the result's notes name them;
  - a name that meets only another entry's key term → a new entry, and a note says whose key it met;
  - no entry → a new entry, as before.
  A change to a lorebook entry is a held change in the session's own book (the lorebook's row untouched); a change
  to an own-book entry is made in place. Both go back with their turn. A write without `shown` behaves exactly as
  before. Places (**File the places**), the assistant's tools and children are untouched.

## Measurement with a real model (lead, 2026-11-13)

Local 12B roleplay model, the sweep's real system text and brief, two existing entries shown, a story that changes
one of them (an inn sold, its namesake pot gone). Temperature 0.7.

| Wording of the block | Runs | Correct update (same name, whole text + change) | Entry repeated word for word (a no-op) | Change filed under a new name |
| --- | --- | --- | --- | --- |
| first (supervisor) | 6 parsed | 0 | 4 | 2 ("The Copper Kettle's History"…) |
| second (adopted) | 5 parsed | 1 (text 1.27× the original, nothing dropped) | 2 | 2 ("The Copper Kettle's Great Pot"…) |

No run shortened an entry. The mechanism is sound; a small model seldom takes the offer. Word-for-word repeats,
which before this lane were refused or doubled, now write nothing. The remaining duplicates are **near-names**, which
no name match can catch; that is the next thing to solve (see ★1).

## Changed files

**SDK** (`../serene-pub-sdk`): `contracts/src/queries.ts` (`entriesNamed`), `contracts/src/outlets.ts` (`shown`
port and doc), `core-catalog/src/shared/lore.ts` (`fileLore` passes `shown`; `ENTRIES_NAMED_BRIEF_SCRIPT`),
`core-catalog/src/seed/scripts.ts`, `core-catalog/src/genres/story/reckon.ts` (sweep: budget, read, brief, `lore`
and `cast` writes match by name), `core-catalog/src/genres/chat/memory.ts` (the same for *Remember things*),
`sdk-tests/entriesNamedBrief.test.ts` (new), `sdk-tests/entryFields.test.ts`, `sdk-tests/coreCatalog.test.ts`,
`sdk-tests/deriveDontSpell.test.ts`, `INTEGRATING.md`, `guides/writing-lore-from-a-pipeline.md`.

**App**: `src/lib/server/pipelines/runtime/loreMatch.ts` (`entriesNamedIn`, `lookLoreMatch`, `matchNameOf`,
`shownIdsOf`, `contentAsRead`, `appendedContent`), `runtime/bindings.ts` (the query's binding; `shown` on the
outlet's ports), `runtime/host.ts` (the `create-lore-entry` case only), tests
`runtime/loreMatch.entriesNamed.int.test.ts`, `runtime/host.loreMatchShown.int.test.ts`,
`sockets/sessions.sweepShown.int.test.ts`, `sockets/sessions.chatMemoryShown.int.test.ts` (all new),
`pipelines/boot/specHashes.test.ts`, `registryHashes.test.ts`, docs `lorebooks.md`, `genre-story.md`, `genres.md`,
`pipelines.md`, `NOMENCLATURE.md` (row and §25).

## Pins moved (re-pinned by the lead)

- `core:outlet/create-lore-entry@1` contract `4906326bc8f09` → `17b54c04c534e9` (one optional in-port; additive).
- `core:query/entries-named@1` new, `1ee43a2b9ae71a`.
- `core:spec/story-sweep@1.0.0` `1bb283916d78e1` → `1c3df06724a475`; `core:spec/assistant-memory@1.0.0`
  `1811e7b16e1c3` → `1ec5139e1a04e6`.
- SDK catalogue digest `f68dcfdeb1e54da7` → `465f556d437bfb56`.
- `deriveDontSpell` ruled counts raised by this lane's own additions only: forward config reference 68 → 70, data
  path in a model answer 179 → 181. The test still fails on counts from other work (see Noticed).

## Provisional names and copy (🚧)

`core:query/entries-named@1` *Entries the lines name*; params *Entry types looked for*, *Entries shown at most*,
*Share — entries shown*; step label *What is already kept*; `core:script/entries-named-brief` *Show the model what
is already kept*; port `shown`.

The block the model reads: "The story already keeps the entries below. For each one: if these lines changed it or
added a fact about it, return it under exactly the same name, with its whole text rewritten to include the change.
If nothing about it changed, leave it out. Never put a change to one of them under another name; a new name is only
for something that has no entry yet." then `Already kept:`; a person's entry adds "(written by a person: keep its
facts and wording unless these lines changed them)".

Notes on a run's record: "N entries answer to 'X' — 'X' (entry 4), 'X' (entry 9); nothing was written for it." ·
"'X' met a key of 'Mira' (entry N); written as a new entry." · "added to 'X' (entry N) as a new paragraph." ·
"'X' (entry N) already says this; nothing was written."

## Tests

See **Verification** at the end of this file.

## Open ★

- ★1 **Near-names.** A model that files a change under a new, similar name ("The Copper Kettle's Great Pot") still
  makes a second entry. Options for a later build: the children build may absorb most of it (a part of something
  becomes its child rather than a rival entry); or a stronger model for the sweep. No fuzzy name match is proposed:
  it would guess.
- ★2 **Guard against a rewrite much shorter than the original.** Not built (as ruled for now). No measured run
  shortened an entry.
- ★3 The provisional names and copy above.

## Noticed, not done

- `deriveDontSpell` also counts 1 forward config reference, 3 data paths, 2 published-state paths and 1 compiled UI
  module id from earlier work, and three `any` spellings in `shared/speakMessage.ts` and `factories/turnOrder.ts`.
- `surface.test.ts` (three untagged exports) and `vocabulary.test.ts` (`your-first-plugin.md`) fail as before.
- The sweep's `scenes` duty (places) still writes without looking for an entry of the name.
- Worker 1 left no report file; its work was read from the diff.

## Verification (lead, 2026-11-13)

- `npm run sdk:build` twice (no dev server, no test run up). Whole `npm run sdk:test`: the failures left are
  `deriveDontSpell` (counts from other work), `surface.test.ts`, `vocabulary.test.ts`; `entriesNamedBrief`,
  `entryFields`, `coreCatalog`, `writes`, `lair` pass.
- App, in a capped scope: `runtime/loreMatch.entriesNamed.int` + `runtime/host.loreMatchShown.int` (16 tests),
  `sockets/sessions.sweepShown.int` (2), `sockets/sessions.chatMemoryShown.int` (2), `sessions.taskSweep.int`,
  `sessions.chatMemory.int`, `pipelines/boot`, `pipelines/parity`, `pipelines/measure`, `attic/upgrade.faithful.int`,
  `lorebooks/`: 99 files, the only failures `boot/placedNodeReconcile.int` and `boot/paramsSlotWiring.test` (speak
  ports, not this lane). The six tests that failed while the SDK was unbuilt pass.
- `shared/conformance`: `commentHistory` and `wiring` fail as before (older files; speak ports; `clock-step.unless`).
- `npx tsc --noEmit -p .` clean; `npm run check` 0 errors.
- End-to-end tests cover: the block in the sweep's and the memory call's prompt with exactly the named entry; a
  shown entry rewritten (held for the lorebook, in place for the session's notes), name kept, no second entry; an
  unshown entry appended to; no block when nothing is named. Ties, key-only, identical text and the swipe are
  covered at the outlet (`host.loreMatchShown.int`), not end to end.

## Scope review and follow-up (lead, 2026-11-13)

The review found the lane inside its brief and the write rule sound (a write without `shown` unchanged; `shown`
never from the model's text; a lorebook entry always held; no match across entry types). Five findings:

1. **Fixed.** The sweep showed people's entries even with **Note new people** off, and never said which list an
   entry belongs in, so a model could return a person under `lore` and make a second entry of another type. The
   script now takes `lists` (entry type → duty): an entry whose duty is off is left out, each line names its list
   (`- (lore) {…}`), and the block adds "Return each one in the list named before it." *Remember things* passes no
   `lists` and reads as before. Test: `entriesNamedBrief.test.ts`.
2. **Half fixed.** `entriesNamedIn` read every entry's text before looking for a name; it now looks on the listing
   and reads text and overlays only for the entries named. **Not done:** the read still runs when `lore` and `cast`
   are both off (the script then shows nothing), and each line is still split into words once per term.
3. **Open ★4.** A rewrite does not check that the entry still says what the model was shown: a person's edit made
   during the model call is replaced (own book) or hidden in this session (lorebook). Fix would pass a stamp of
   the text shown and append when it differs.
4. **Fixed here.** The brief's carried ★, missing above: ★5 under Review the reviewer sees a plain "create" and is
   not told that approving rewrites or extends an entry; editing the name there leaves the match at the model's
   name. ★6 the assistant's write tool is outside this rule. ★7 places and rooms keep their own name checks, and
   the sweep's `scenes` duty has none. ★8 a person as character lore and a cast member are different tables; a
   match never crosses them. Also: "no created event for a rewrite or append" is tested as `written: false`, not
   by watching the event.
5. **Fixed.** The outlet's doc sentence on the append case.

**Follow-up verification (lead, 2026-11-13).** One `npm run sdk:build` with no dev server or test run up. Pins moved
again by finding 1's fix: `core:spec/story-sweep@1.0.0` `1c3df06724a475` → `13928b1544e250`; SDK catalogue digest
`465f556d437bfb56` → `f6f145e14824ad14`. SDK `entriesNamedBrief`, `coreCatalog`, `entryFields`, `writes`, `lair`
pass. App, capped scope: the four lane test files, `sessions.taskSweep.int`, `sessions.chatMemory.int`,
`boot/specHashes`, `boot/registryHashes`, `pipelines/parity`, `pipelines/measure`: 22 files, 184 tests, all pass.
`npx tsc --noEmit -p .` clean. `npm run check` 0 errors.

**Owner direction on ★4 (2026-11-13):** "Mark the entry, or rather mark it in the runs metadata, check the runs
when going to save an entry, or also show a notice in the form. Can probably do something similar to prevent
collisions elsewhere". Then, asked what a save does meanwhile: "Prevent the save, keep as draft, tell the user
upfront"; and how the form learns it: "Notice on open and on save". Built as lane `run-reads-entry`
(`plans/briefs/BRIEF-run-reads-entry.md`).
