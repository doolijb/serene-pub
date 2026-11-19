# BRIEF — build lane `kn-2a` — the knowledge filter lives in the queries (programme 1.2, first half)

**Cut after cold review (2026-11-16): this lane builds the knowledge param only. The presence param and rule
(everything about `attendedBySpeaker`, `firsthandFor` / `firsthandBy`, `sessions/firsthandFilter.ts`) is lane
`kn-2b`, not launched: it waits on DISCUSS-LATER D21. Where this brief describes presence, read it as context
for the shape the speaker resolution and the per-run cache must leave room for; build none of it, and leave
`firsthandFor` / `firsthandBy` and their laws exactly as they are.**

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-query-filters-2026-11-16.md` (the facts; **re-verify every file:line**),
`../serene-pub-sdk/INTEGRATING.md` §1p, `plans/REPORT-time-t6c2-2026-11-15.md`,
`plans/REPORT-time-t6f-2026-11-15.md`, `NOMENCLATURE.md` §1, §23, §24 and rows 959–962, `docs/pipelines.md`
344–372, `docs/lorebooks.md` ~116.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root. Delete only your own `/tmp/serene-pub-vitest-*` dirs by name. Before any `npm run sdk:build`
(from the app root): `pgrep -af "vite"` (dev or preview: if one is up, do not build; report "blocked on your dev
server") and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` (wait for it to end). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-2-<n>.log 2>&1"`,
one run at a time. No migration is expected; if one seems needed, stop. Inside `db.transaction` use only `tx`.
No full run and no `npm run build`: the lead runs those at the phase boundary.

## Owner (2026-11-15)

"I expect you to close all the leaks as part of the sprint. When querying on a characters history/knowledge,
have it be a toggle that's on by default, that way a modder can disable it if they want to do somethign custom.
Since it's an SDK built-in, I'm thinking it should be in the query markup, not in the helper tooling that core
genres use."

Earlier the same sprint: presence = "Stored cast list, when messages are outside the context window, we won't
be querying them anyway. Scenes/history are what persist."; knowledge = "everyone by default" (an entry is known
to everyone unless marked *not common knowledge*; then only those with a knowledge tie); cheap, no model call.
Standing: P1 (deterministic, never hidden: every automatic action shows its cause and how to switch it off);
prompts: comprehension and fidelity first; Bench is not absence.

## What is built

### A. Two params on every read that returns lore, links, places or history

On each read in the inventory's §1 table that can hand a speaking character text or names:
🚧 `knownToSpeaker` (boolean, default `true`) on reads of entries, links and places;
🚧 `attendedBySpeaker` (boolean, default `true`) on reads of lines, scenes, summaries, history entries and
recalled lines. A read that returns both kinds takes both. Each param's description says in one sentence what it
drops and when it does nothing. (Names are provisional, marked 🚧, recorded in NOMENCLATURE §25, and go to the
owner's names pass, DISCUSS-LATER D1.)

- **Who the speaker is:** the read's own `speaker` in-port when wired, else the character the run speaks as,
  taken from the `scope` value the read already receives (the inventory §3: a binding has no other way). A run
  that speaks as nobody (narrator turn, routine, summary, action, event, envoy, a multi-voice step) has no
  speaker: both params do nothing and the read returns everything, as today. A card-less seat is a speaker
  (`currentCastMemberId`); fix the link hop, which passes only `currentCharacterId` today.
- **Knowledge rule** (`lorebooks/entryKnowledge.ts`): an entry marked not common knowledge is dropped
  unless the speaker has a knowledge tie to it, **or it is the place the speaker stands in** (its place value at
  the run; owner 2026-11-15, `PLAN-entry-time-and-lines-2026-11-14.md` ~315: "the place a character stands in
  counts as known": "Yes, add it to the plan."). The standing-place exception is new code in this lane, with a
  test: a delver standing in a marked room still gets that room in the place listing and its prose. Dropped **at the source**, so nothing downstream sees it:
  the three lore lanes, `entries-named`, `vector-search`, `entity-search`, `entity-link` / `mention-spans` where
  they return entry text or names, `lorebook-triggers` (an unknown entry neither triggers nor is scanned in
  recursion), `relationship-search` (the hop never arrives at, nor names, an unknown entry; a link whose other
  end is unknown is dropped), `lorebook-entries` including `withLinks` (place listing and ways),
  `relationships-known` / `-perspectives` where an end is an unknown entry, `turn-plan`'s `locationPassage`.
- **Presence rule** (changes; state it once in `sessions/firsthandFilter.ts` and in the docs): the speaker was
  there for a scene when it is in the scene's **stored cast** or **spoke a live line in it**. Lines of a scene it
  was not there for are dropped from `session-history` and recalled lines; a scene summary / `earlier-scenes` row
  is dropped when it was not there; a history entry is dropped when the speaker was there for none of this
  session's scenes behind it (an entry with no session scene behind it, or text a person wrote, stays: say so in
  the param's description). The slot-based place comparison and the "more than half" rule go, unless a test
  shows the stored cast is missing for open scenes (then keep *spoke* as the open-scene rule and report).
- **One load per run:** the knowledge facts and the presence view are loaded once per run and speaker and
  shared by every read of that run (a per-run cache keyed by run id and member; freed when the run ends: find
  how other per-run caches are freed and follow that). Statement ceilings: with both params on, a Story reply
  adds no more than today's `unknown-entries` + one `loadFirsthandView` (state the measured numbers).
- **Shown, never hidden (P1):** each read's receipt / run record says how many rows each param dropped (follow
  how `unknown-entries` reports today; no new UI in this lane).

### B. What it replaces

- `core:query/unknown-entries@1`, the `firsthandFor` / `firsthandBy` in-ports, the `exclusions` plumbing they
  feed, their `validate()` laws, and the placements in Story (`story/respond.ts`) and the Lair (`lair/reply.ts`)
  are removed. **First confirm none of these names is in a published release** (`git tag --contains` the commits
  that added them, in both repos; they were added 2026-11-15/16). If one shipped, stop and report: removing a
  published SDK name is the owner's call.
- `validate()`: a **warning** when a read with a param left on sits in a pipeline that can never have a speaker
  is not wanted (it would warn on every routine). Instead: no law. The defaults are the protection.
- Every shipped genre gets the defaults by doing nothing. For each shipped read that must see everything while a
  character speaks (look for them: a narrator-voiced step inside a speaking run, sweep; the Lair's spine needs no `false`: it is
  filtered on a delver's run, which closes the shared-`gather` leak, and has no speaker on the Castellan's), either
  the run has no speaker (nothing to do) or the spec sets the param `false` **with a one-line reason comment**.
  List every `false` in the report. Chat and Guide (`family === 'assistant'`): the assistant is the speaker;
  check that a card's own lorebook entries marked not-common-knowledge still reach it when tied, and report what
  changes for them.

### C. Tests

- Per read: a row the speaker does not know / was not there for is absent with the default, present with the
  param `false`, present for a run with no speaker; card-less seat; the hop and `withLinks` never name an
  unknown entry; triggers recursion never scans one.
- The one-load ceiling (statement counts, as `firsthandFilter.int.test.ts` does).
- Existing pins move on purpose: registry and spec hashes (re-pin with "(was …)"), `declaredReads`,
  `wiring.test.ts` excuses for `firsthandFor/By` removed, receipts, scoping, the two prompt-baseline tests
  (`unknownEntries.reply`, `sessions.lairUnknownEntries`: the prompt text must be **identical** to today's for
  the same data, since the rule did not change for knowledge; a difference is a finding), the parity harness,
  SDK `sdk-tests/*` named in the inventory §6, the guide's recipes (`spoke-or-named` is rewritten or removed).

### D. Docs and names

`INTEGRATING.md` §1p rewritten for the params; the guide `genres-presets-and-routines.md` sections; 
`docs/pipelines.md`, `docs/lorebooks.md`; NOMENCLATURE rows (retire `unknown-entries`, `firsthandFor`,
`firsthandBy` in §23 only if they never shipped: else ⏳; new params 🚧; §25). Comments state the rule, not the
story. No other product's name anywhere.

## Order of work (sequential: the same files)

1. Speaker resolution + the per-run cache + the knowledge param on the three lore lanes (prompt baselines
   identical) → remove `unknown-entries` and its wiring (the exclusions warning of ruling §11.7 goes with it).
2. Knowledge param on the remaining reads (the leaks) + the standing-place exception.
3. (lane `kn-2b`, not this lane.)
4. Docs, names, hashes; `npm run sdk:build`; SDK tests (`npm run sdk:test` in the capped form: only the four
   known failures).

## Files owned

SDK: `contracts/src/queries.ts`, `sdk/src/validate.ts`, `core-catalog/src/genres/story/respond.ts`,
`lair/reply.ts`, any shipped spec that needs a `false`, the tests and guide named above, `INTEGRATING.md`.
App: `pipelines/runtime/bindings.retrieval.ts`, `bindings.outlets.ts`, `bindings.relationships.ts`, the
`session-history` binding in `bindings.ts`, `host.read.lorebookEntries.ts`, `host.read.retrieval.ts`,
`ranking/keywordQuery.ts`, `ranking/eligibility.ts`, `loreMatch.ts`, `lorebooks/entryKnowledge.ts`,
`sessions/firsthandFilter.ts`, their tests, the pinned tests named in C, the docs, `NOMENCLATURE.md`.
**Not** `sockets/sessions.ts` or its `sessions.*.ts` modules (another lane is splitting them).

## Out of scope

Knowledge screens and the write API (1.4); attended-scene summaries as a new read (1.3); cast Memory; distances;
any UI; any new setting; model-judged knowledge; changing who knows what by default.

## Stop and ask when

CLAUDE.md §Decisions applies; a name shipped; a prompt baseline changes for unchanged data; a read cannot learn
the speaker from `scope` or a port; the stored cast is not reliable for open scenes; a shipped spec's behaviour
would change for a player in a way this brief does not name (report it before building it); a migration.

## Done means

All tests in C green in the capped form; `sdk:test` only the four known failures;
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors; `npm run check` 0 errors.

## Report

Final message = the report (lead saves `plans/REPORT-kn-2-<date>.md`): per read, what each param drops and
where; how the speaker is resolved; every `false` set and why; what changed for each shipped genre; statement
counts; names added and retired; changed files; tests; open ★; **Noticed, not done**. Under about 900 words.
