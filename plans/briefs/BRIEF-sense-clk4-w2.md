# BRIEF — worker `sense-clk4-w2` — an empty junction branch survives the app's spec store

You are a `lane-worker` under supervisor `sense-clk4`. Repos: app `/home/jody/github/serene-pub`, SDK
`/home/jody/github/serene-pub-sdk`. Use absolute paths. Another session is editing the app (visual-novel layout work:
dialogue box, layouts); never touch its files. No other lane is building now. **Do not edit the SDK and do not run
`sdk:build`**: worker w1 already changed and built it (below).

## Why

`src/lib/server/pipelines/boot/store.ts` `chainsOf` (~1175–1200) rebuilds a clause's chains from the nodes and nested
clauses that sit in them ("chains are not stored"). A junction branch with **no member** (`.when('review', {...},
(e) => e)`) vanishes on load. The round tick (`core:spec/round-tick`) has a junction `clock.moves.clocked.at.keeper`
with two empty branches (`review`, `full`) and an `otherwise` branch `tick` holding the clock move; loaded from the
store it has only `tick`, so the default fires and, under the Lair's *Words only* with the keeper switched on, the
clock moves twice a round (once by the keeper, once by the tick). Any author's empty branch falls through the same
way.

The fix follows **one ordering rule, shared with the SDK's compile step** (w1 built it in
`/home/jody/github/serene-pub-sdk/sdk/src/document.ts` `orderedChains`; read it):

> **A clause's chains are its member-holding chains in position order (the position of each chain's first member,
> node or nested clause — what `chainsOf` does today), then its member-less chains sorted by name (plain code-unit
> order: `a < b ? -1 : a > b ? 1 : 0`, never `localeCompare`).**

The member-less chains come from the stored `branches` (jsonb column `pipeline_clauses.branches`, a junction's
`{ [chain]: predicate }`): every key of it that holds no member. jsonb does not keep key order, which is why the
rule sorts them by name. A gather/each/loop clause has no `branches`, so nothing changes for it. A document's hash
(`canonicalHash`, SDK `hash.ts`) sorts object keys but keeps array order, so the rebuilt `chains` must equal the
compiled ones exactly.

## What exists (re-read these lines before changing anything)

- `store.ts` ~1150–1170 (the `clauses:` map in `loadDocument`, call site `chains: chainsOf(nodeRows, clauseRows,
  b.clauseId)`), ~1175–1200 (`chainsOf` and its docblock), ~196–215 (how `branches` is saved).
- `src/lib/server/pipelines/boot/clauseChainRoundTrip.int.test.ts`: the store's round-trip tests (save, load, hash
  equal; every shipped core spec published at boot loads back as the in-code document; a heal on reboot). Its
  "every shipped core spec" test fails today for `core:spec/round-tick`.
- `src/lib/server/pipelines/boot/seed.ts` ~259–360 `seedCoreSpecs(db)` → `SpecSeedReport[]` with `action:
  'present' | 'published'` per spec; it matches a stored version by the in-code document's `canonicalHash`.
- `src/lib/server/pipelines/routines/clockOwners.int.test.ts`: already has the two *Words only* cases (keeper Off: one
  move by the tick; keeper switched on at Review: one move, not two). The second fails today (two moves).
- `src/lib/server/pipelines/boot/specHashes.test.ts` ~1934–1936: the `core:spec/round-tick@1.0.0` pin and its notes.
  `registryHashes.test.ts`: pins of the registries.

## Tasks

1. **`store.ts`, `chainsOf` and its call site only.** Pass the clause row (or its `branches`) so `chainsOf` returns
   the member-holding chains as today, then every `branches` key that holds no member, sorted by name (code-unit
   order). Update the docblock: the rule in one sentence, that it is the SDK compile step's rule (`orderedChains` in
   the SDK's `document.ts`) so a loaded document hashes as it was saved, and that an empty branch is a real branch
   (taking it runs nothing and keeps `otherwise` from firing). Nothing else in `store.ts`.
2. **Tests in `clauseChainRoundTrip.int.test.ts`** — a new `describe("a branch with no member survives the store")`:
   - Build test specs with the SDK builder and `compile` (`spec`, `compile`, `coreEvents` from `@serene-pub/sdk`,
     `* as C` from `@serene-pub/contracts`), modelled on the round tick
     (`/home/jody/github/serene-pub-sdk/core-catalog/src/shared/roundTick.ts`): an event inlet
     `C.sessionEvent.v1()` with `{ suits: [coreEvents.roundEnded] }`, a `C.sessionSettings.v1({ scope:
     $.event.sessionScope })` query, and a junction on its `main` whose member-holding branches hold a
     `C.castPresences.v1({ scope: $.event.sessionScope })` query. Ids `test:spec/empty-branch-…`. Three cases: one
     empty branch declared **first**, in the **middle** (between two member-holding branches) and **last**; plus one
     with two empty branches declared out of name order. For each: `saveDocument(db, doc, { publish: true })`, then
     `loadDocument(db, saved.specVersionId)`: the junction's `chains` equal the compiled document's, the empty
     branch is among them, and `canonicalHash(back) === canonicalHash(doc)`; saving the same document again returns
     `written: false`.
   - **A second boot publishes nothing:** after the file's existing `bootstrapPipelines(db)` has run (reuse the
     file's DB; order the test after the existing boot test or call `bootstrapPipelines` itself), call
     `seedCoreSpecs(db)` and assert every report's `action` is `"present"`. And the loaded round tick: its keeper
     clause `clock.moves.clocked.at.keeper` has chains `["tick","full","review"]` and hashes as the in-code
     document (the existing "every shipped core spec" test then passes too).
   - 60 s timeout on every `it` that opens or writes the DB (180 s where it boots, as the file does).
3. **Run** (app root, capped; never pipe vitest into `head`):
   `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3
   src/lib/server/pipelines/boot/clauseChainRoundTrip.int.test.ts src/lib/server/pipelines/boot/store.int.test.ts
   src/lib/server/pipelines/boot/specHashes.test.ts src/lib/server/pipelines/boot/registryHashes.test.ts"`, then
   separately `src/lib/server/pipelines/routines/clockOwners.int.test.ts
   src/lib/server/pipelines/routines/roundTick.int.test.ts
   src/lib/server/pipelines/routines/roundWorth.genres.int.test.ts`. `clockOwners.int` must be **6/6**.
4. **Pins.** `specHashes.test.ts`: re-pin `core:spec/round-tick@1.0.0` with a dated note line in the file's style,
   added above the pin after the existing notes: `// Moved 2026-11-11, sense-clk3 + sense-clk4: Words only
   registers the round tick and the tick steps aside while the Lair keeper runs (steps `modes` and `keeper`, branches
   review, full, tick); compile lists a clause's member-less branches last, by name (tick, full, review). Edited in
   place. (was "123220d7c924ea")`. `registryHashes.test.ts`: re-pin only if it moves for this change, with a dated
   `sense-clk4` note. **If a pin moves for any spec other than `core:spec/round-tick`, do not re-pin it: stop and
   report it.**
5. **Typecheck:** `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
   — clean, or list the errors and show they are in files you did not touch.
6. `npx prettier --check <file>` on each file you changed (if a file was already unformatted before you, say so; do
   not reformat whole files). Delete only the `/tmp/serene-pub-vitest-*` dirs your own runs made, by name.

## Files owned (edit only these)

App: `src/lib/server/pipelines/boot/store.ts` (`chainsOf`, its docblock and its one call site only),
`src/lib/server/pipelines/boot/clauseChainRoundTrip.int.test.ts`, `src/lib/server/pipelines/boot/specHashes.test.ts`
(the round-tick pin only), `src/lib/server/pipelines/boot/registryHashes.test.ts` (pins only, if they move).

## Files readable

Anything. Not editable: everything else, including the SDK, `clockOwners.int.test.ts` (edit it only if it fails for a
reason other than the store defect: then stop and report first), `seed.ts`, `db/schema.ts`, `NOMENCLATURE.md`.

## Out of scope

Storing chains in a column (no migration); the canvas editor (`components/pipelines/workspace/canvas/*`); any new
predicate kind; `replyRoad.int.test.ts`; healing stored versions; anything else.

## Stop and ask (in your report) when

A migration or schema change would be needed; a pin moves for a spec other than the round tick; `clockOwners.int`
still moves the clock twice after the fix (report what the loaded document holds); anything outside the owned files
must change.

## Done means

Tasks 1–2 built; the seven test files in task 3 pass (report pass/fail counts per file; `clockOwners.int` 6/6); the
pin re-pinned; tsc clean; prettier reported.

## Report (your final message)

Changed files; the new `chainsOf` signature; each test name you added; pins old → new (and any you refused);
tests with counts; tsc; prettier; anything that surprised you; Noticed, not done.

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
