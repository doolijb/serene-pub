# BRIEF — worker `sense-clk4-w1` — the SDK's compile orders a clause's chains by one rule

You are a `lane-worker` under supervisor `sense-clk4`. Repos: app `/home/jody/github/serene-pub`, SDK
`/home/jody/github/serene-pub-sdk`. Use absolute paths. Another session is editing the app (visual-novel layout work:
dialogue box, layouts); never touch its files. No other lane is building now.

## Why

A junction branch with **no member** (no node and no nested clause in it), e.g. `.when('review', {...}, (e) => e)`,
is stored by the app but its chain is rebuilt on load from the members that sit in it, so an empty branch vanishes
and the junction's `otherwise` fires instead. The app's store (`src/lib/server/pipelines/boot/store.ts` `chainsOf`)
will be fixed by worker w2 after you, by adding member-less branches back from the stored `branches` (a jsonb
column, so its key order is NOT the declaration order). A document's hash keeps array order (`sdk/src/hash.ts`
`sortDeep` sorts object keys only), so the chains the store rebuilds must come back in exactly the order the
compiler wrote. Hence **one ordering rule, on both sides**:

> **A clause's chains are its member-holding chains in position order (the position of each chain's first member,
> node or nested clause — what the store does today), then its member-less chains sorted by name (plain code-unit
> order: `a < b ? -1 : a > b ? 1 : 0`, never `localeCompare`).**

The supervisor measured every clause of every compiled core spec (77 specs, 179 clauses): the member-holding order
already equals the builder's declaration order everywhere, and the only clause with member-less chains is the
round tick's `clock.moves.clocked.at.keeper` (declared `["review","full","tick"]`, rule order
`["tick","full","review"]`). So the rule moves only `core:spec/round-tick`'s hash; it never changes which branch
**runs** (the executor evaluates every chain's predicate, and `otherwise` fires exactly when no other did, whatever
the order).

## What exists (re-read these lines before changing anything)

- `sdk/src/builder.ts` ~1185–1215: `JunctionBuilder.when` / `.otherwise` push each name onto `clause.chains` in
  declaration order; `GatherBuilder.chain` ~1149 likewise.
- `sdk/src/document.ts` `compileBuilt` (~255–405): returns `clauses: built.clauses` as is. **This is the compile
  step that writes `clause.chains`.** `compile(SpecDocument)` (an already-compiled document) goes through
  `importDocument` (a deep copy) and must stay untouched.
- `sdk/src/executor.ts` ~2507–2545: junction firing (`fired`, `anyFired`, `default`), `collected` per chain.
- `sdk-tests/route.test.ts` and `sdk-tests/helpers.ts` (`publish`, `bindings`, `world`): the pattern for an executor
  test of a junction (`run(publish(spec), { world, input, seed, triggerSource: 'event', bindings })`, receipt
  `nodes` / `notes`).
- `core-catalog/src/shared/roundTick.ts`: the round tick; its keeper junction declares two empty branches
  (`review`, `full`) then `.otherwise('tick', …advance…)`.
- `sdk-tests/coreGenreDefaults.test.ts` ~212–287: the parity test (fails today: `lair-words-only: events` gains
  `'core:event/round-ended@1': 'core:spec/round-tick'`) and the round tick test (fails today: it looks up
  `clock.moves.clocked.at.advance`; the outlet is now `clock.moves.clocked.at.keeper.tick.advance`).

## Tasks

1. **`sdk/src/document.ts`**: in `compileBuilt`, return each clause with its `chains` ordered by the rule — a
   private (non-exported) helper beside `compileBuilt`, taking the clause, `built.nodes` and `built.clauses`. Do not
   mutate `built` (copy each clause: `{ ...c, chains }`). Do not change `compile(SpecDocument)` / `importDocument`.
   A short docblock on the helper: the rule in one sentence, why (the store rebuilds chains from members and from
   `branches` keys, which jsonb does not keep in order; the hash keeps array order), and that the app's store
   `chainsOf` follows the same rule. **No new export, no new published name, no change to the document's shape.**
2. **New test file `sdk-tests/junctionEmptyBranch.test.ts`** (node:test + `assert/strict`, like `route.test.ts`;
   define your own `demo:`/`test:` task definitions with `pin(describeTaskDefinition(...))` as route.test.ts does,
   with ids that do not collide with existing ones — grep first):
   - compile orders chains by the rule: one empty branch declared **first**, in the **middle** (between two
     member-holding branches) and **last**; two empty branches declared out of name order (e.g. `b` then `a`) come
     out `a`, `b` after the member-holding ones; a branch whose only member is a nested junction keeps its position
     among the member-holding ones; a gather clause's chains are untouched when every chain holds a member.
   - `compile(compile(built))` gives the same chains (an already-compiled document is not reordered again, and its
     `canonicalHash` equals the first compile's).
   - **Executor:** a junction with an empty `when` branch and an `otherwise` holding a task: when the empty branch's
     predicate holds, the receipt's notes say it `fired` and the `otherwise` was `skipped`, no node of the
     `otherwise` ran (no receipt node under its key), and the run's outcome is `ok`; when it does not hold, the
     `otherwise`'s task runs.
   - the round tick's keeper junction compiles to `["tick","full","review"]` (import `roundTickSpec` from
     `@serene-pub/core-catalog`; find the clause `clock.moves.clocked.at.keeper`).
3. **`sdk-tests/coreGenreDefaults.test.ts`** (lines ~212–287 only):
   - parity: Words only now registers the round tick (owner ruling 2026-11-11, lane sense-clk3: "Routine; Words only
     uses the round tick"). Add an `ADDED` map beside `DROPPED` (`'lair-words-only': { [ev('round-ended')]:
     'core:spec/round-tick' }`) and expect `{ ...TODAY[p.genre].events, ...ADDED[p.slug] }`. Check the seed-rows loop
     below it the same way (`corePresetSeeds()`: find the Words only seed's key and whether its bindings carry
     round-ended; make the expectation match what the seed really holds, and report which it was).
   - the round tick test: rename the title to say Story and the Lair's Words only; keep "genre defaults: Story only"
     (Words only adds it in its preset, not the genre's defaults); add: under `corePresets()`, `lair-words-only`
     registers the tick on `round-ended` and every other Lair preset does not. Replace the old outlet key with
     `clock.moves.clocked.at.keeper.tick.advance`; assert the `modes` query (`clock.moves.clocked.at.modes`,
     `core:query/session-settings`) and the clause `clock.moves.clocked.at.keeper`: `on` = `{ __ref: 'data', node:
     'clock.moves.clocked.at.modes', port: 'main' }`, `clauseId` `clock.moves.clocked`, `chains`
     `['tick','full','review']`, branches `review`/`full` with `path: 'routineModes.core:spec/lair-keeper'` and
     `equals`, `tick` `{ default: true }`; and that the outlet's `clauseId` is `clock.moves.clocked.at.keeper`.
     Check the real key names in the compiled document first; if they differ from these, use the real ones and say so.
4. **`core-catalog/src/shared/roundTick.ts`**: one sentence in the "third gate" paragraph of the docblock: the two
   branches `review` and `full` are empty on purpose (taking one moves nothing), and a compiled document lists them
   after `tick` (member-less branches come last, by name). Nothing else in that file.
5. `sdk-tests/coreClockOwners.test.ts`: run it; edit only if it fails because of task 1 (report why).
6. **Build once, then tests and the pin.** After ALL SDK source edits: run `pgrep -af "vite dev"`; if a serene-pub
   dev server is up, do not build: report "blocked on your dev server". Otherwise
   `cd /home/jody/github/serene-pub && npm run sdk:build` once. Then from `/home/jody/github/serene-pub-sdk/sdk-tests`,
   each with `npx tsx --test <file>`: `junctionEmptyBranch.test.ts`, `route.test.ts`, `junctionResult.test.ts`,
   `typedBuilders.test.ts`, `coreClockOwners.test.ts`, `coreGenreDefaults.test.ts`, `coreCatalog.test.ts`,
   `conformance.test.ts`. Then the suite's typecheck: `cd /home/jody/github/serene-pub-sdk/sdk-tests &&
   systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx tsc --noEmit"` (report
   errors in files you touched; others' errors: list, do not fix).
   **`coreCatalog.test.ts`'s digest** (~1068–1069) will move because the round tick's chains reorder. Re-pin it with
   a dated note in the file's style, appended after the sense-clk3 line: `// Moved 2026-11-11, sense-clk4: compile
   orders a clause's chains (member-holding by position, then member-less by name), so the round tick's keeper
   junction lists tick, full, review. Not proven by deletion: taken on a dist that also carries any other session's
   catalogue changes since the previous pin. (was '4347914b6a33b299')`. **If any other pin or test moves for a spec
   other than `core:spec/round-tick`, do not re-pin it: stop and report it** (that would mean the rule moves a
   shipped spec). If a fix needs another SDK source edit after the build, make it, rebuild once more, and say so.
7. `npx prettier --check <file>` on each file you changed; compare with how the file stood (if it was already
   unformatted before you, say so; do not reformat whole files).

## Files owned (edit only these)

SDK: `sdk/src/document.ts` (the helper and its use in `compileBuilt` only), `sdk-tests/junctionEmptyBranch.test.ts`
(new), `sdk-tests/coreGenreDefaults.test.ts` (~212–287 only), `sdk-tests/coreClockOwners.test.ts` (only if task 5
requires), `sdk-tests/coreCatalog.test.ts` (the digest pin only), `core-catalog/src/shared/roundTick.ts` (one
docblock sentence).

## Files readable

Anything. Not editable: everything else — the app (worker w2 owns the store), `NOMENCLATURE.md` (the supervisor
writes it), `builder.ts`, `executor.ts`, `validate.ts`, every other SDK file.

## Out of scope

Storing chains anywhere; any new predicate kind, port, export or published name; the validator; `importDocument`;
reordering anything but `chains`; the app.

## Stop and ask (in your report) when

The rule would change which branch runs for any spec; a pin moves for a spec other than the round tick; a new export
or published name would be needed; the document's shape would change; anything outside the owned files must change.

## Done means

Tasks 1–4 built; every test file in task 6 passes (report pass/fail counts per file); the digest re-pinned with the
note; prettier results reported.

## Report (your final message)

Changed files; the helper's name and signature; each test name you added; the Words only seed finding (task 3); the
digest old → new; tests run with counts; tsc result; prettier results; anything that surprised you; Noticed, not done.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write "no
  lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
