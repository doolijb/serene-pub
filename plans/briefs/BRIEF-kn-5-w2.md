# BRIEF — worker `kn-5-w2` (lane `kn-5`, part B): one *Only what the speaker knows* switch per pipeline in the panel

App `/home/jody/github/serene-pub`. Supervisor: lane `kn-5`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You edit no SDK file, so you run no `sdk:build` at all.)

Also: never `git checkout / restore / stash`; never `prettier --write`; no migration; inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in tests); never `pkill -f` a generic pattern; never pipe vitest into `head`.

## Goal (owner ruling D36, 2026-11-16: "One switch for the pipeline's lore reads, under Advanced")

Today the Pipelines panel derives a `knownToSpeaker` control (label *Only what the speaker knows*) on every read that declares it: about eight on Story's reply. Build **one derived control per pipeline** in its place, **in the panel only**:

- **No SDK contract change, no run-time change. Do not mark `knownToSpeaker` `shared`** and do not reuse the scan settings' `shared` / `ofNode` mechanism (`config/panel/declarations.ts` ~904–934): that would make the run read the owner lane's value and silently override a modder's per-query value.
- **Keep the per-read `Decl`s in `declarations()`**: `reconcileConfigs` back-fills and culls stored rows from that list, so dropping them would cull the very addresses this control writes. The change is in what the panel (and the session settings form) **shows**, and in how a write to the new control is fanned out.

## The control (a 🚧 "ganged control"; name everything you add with the stem `ganged`, e.g. `config/panel/ganged.ts`; the supervisor records the name)

1. **Who has one.** A pipeline (one published spec version) whose `declarations()` hold **two or more** `params` decls with `path === "knownToSpeaker"`. With one, nothing changes (that read's own option stays). Keep the mechanism private to the panel directory (a small pure helper, plus its wiring in `read.ts` / `write.ts`); it handles this one param, by a constant; no general registry, no option for other params.
2. **Where it sits.** In the Advanced step of the read that **owns the lore lanes**: the node the other lore lanes' `params` reference through `{ __ref: "slot", ofNode }` in `pipeline_nodes.config` (Story's reply: `gather.worldLore.read`, where the seven scan settings sit). A pipeline with such reads and no lore-lane owner shows it on the **first** such read's step in spine order. In `namespaceView` (`read.ts` ~441–823) that means: build the member options as today but do not push them into `placed`; push **one** option, placed with the home read's `Decl` (`placed.push({ d: homeDecl, option })`), so `settingsGroupsOf` puts it in that step's Advanced with no change to `groups.ts` (a params field that is not `settings.enabled` already lands in Advanced; verify).
3. **What it shows.**
   - `id`: a fresh opaque handle from `optionId(secret, …)` over an address no real node key can spell (e.g. a `\u0001`-prefixed pseudo node key); never a node key in the payload (`ids.ts` header).
   - `label`: *Only what the speaker knows*. `description` (★, one sentence): *Leaves out what the speaking character does not know, on every lore read of this pipeline.*
   - `value`: the value every member holds; when they differ, the value most members hold (a tie: the declared default, `true`), and `provenance: { source, label: "Set differently on ‹n› of this pipeline's reads" }` (★) where ‹n› is how many members hold the other value. The client already prints `provenance.label` under a writable row (`PipelineConfigOptions.svelte` ~1014, ~2399): no client change. Extend the `provenance` doc comment in `types.ts` to say it also carries this.
   - `source`: the members' common source, else the most specific of theirs (`session` › `config` › `author`). `changed` / `overriddenHere`: true when any member's is. `writable`: true only when every member's is. `authorDefault`, `decl`, `control`: the home member's.
4. **What it writes.** `writeOption` / `clearOption` (`write.ts`) on the ganged id write **each member read's own stored address**, exactly as each per-read control wrote it (same scope resolution, `holdsRow` / reset-is-delete per address, genre values / instance values / the session's registration values via `writeSessionValue`), **in one transaction**: resolve every input first (`locate`, `declarations`, `globalTarget`, `declaredDefaultAt`, `resolveWriteScope`), then `db.transaction(async (tx) => …)` and pass `tx` to every write (`setGenreValue`, `setInstanceValue`, `writeSessionValue` take a handle and use only it; `writeSessionValue` opens its own transaction, which nests on `tx`). `locate` resolves the ganged id when no single decl matches. Refactor the single-decl write body into a function both paths call; do not change single-option behaviour.
5. **Stop and report, building nothing further, if**: the writes cannot be made atomic as above; or the members' locks differ in any shipped pipeline (`settingLocksOf` in `registrations/values.ts`, used by `layers()` in `read.ts` ~140; and `lockedAt` in the settings form). Check shipped data and say what you found either way.
6. **The session settings form** (`src/lib/server/sessions/settingsForm.ts`, `pipelineGroup` ~534–700): it lists every `params` decl to an administrator, so it shows one *Only what the speaker knows* per read. Make it follow the same one control, with no wire change: one `Field` at the **home** read's address (`address.kind === "pipeline"`, the home node key) instead of one per member, `label` / `description` as above (when members differ, append the ★ words as a second sentence of `description`, since `Field` has no note line), `value` / `inherited` as the majority rule above, `editable` only when every member's is (its `lockedAt` / `fixed` from any member that has one), and its `located` write patching **every member's** address in each registration (`patchSessionRow` + `valuesWith`, as the per-field write does) in one transaction. Use the same helper from `config/panel/` to find the members and the home. Members still see none of it (reach unchanged). Re-read the file right before editing.

## Rules you work under (quoted)

- NOMENCLATURE §24: "Pick a **distinctive** word (R2)." "Grep for it first — across `src`, the SDK, and the schema." "Say what it is **not**, in the declaration, if a near-neighbour exists." Say in the helper's header that a ganged control is **not** a `shared` field (`FieldDecl.shared`, the scan settings' owner-lane mechanism, which the run reads).
- `ids.ts`: "the payload carries **no topology** — not the node key, not the count, not the order."
- `write.ts` header: "**Reset deletes.**" and "a write that lands back on the default" deletes the row.
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx`."
- CLAUDE.md P5: core builds the UI from declarations; this control is derived, never declared.
- CLAUDE.md Decisions: any user-visible copy or new name beyond those given above is ★: stop and say so instead of inventing it.

## Files owned

`src/lib/server/pipelines/config/panel/` (new helper; `read.ts`, `write.ts`, `types.ts` comment); `src/lib/server/sessions/settingsForm.ts` (the ganged field only); tests: `config/panel/index.int.test.ts`, a new `config/panel/ganged*.test.ts` (unit) and/or `ganged*.int.test.ts`, `pipelines/boot/lorebookTriggerControls.int.test.ts`, `pipelines/boot/retrievalModeCull.int.test.ts`, `pipelines/runtime/knownToSpeaker.defaultsOff.int.test.ts` (one added case at most), the settings form's existing int test for one case (find it: `grep -rln "settingsForm" src --include=*.int.test.ts`).

## Files readable

Everything. Notably `config/panel/groups.ts`, `registrations/values.ts`, `registrations/genreValues.ts`, `registrations/instanceValues.ts`, `config/deviations.ts`, `sockets/pipelines.ts` (~160–330: how the socket re-finds an option by id after a write), `client/components/pipelines/PipelineConfigOptions.svelte`.

## Out of scope

Any SDK file; `groups.ts` unless placement cannot work without it (then stop and ask); docs and `NOMENCLATURE.md` (the supervisor writes those); the client.

## Tests (Done means)

- New: for **every shipped published pipeline** with two or more reads declaring `knownToSpeaker`, `namespaceView` (admin, config scope) shows exactly one *Only what the speaker knows* option, in the Advanced of the home step (Story's reply: the world-lore lane's step), and no per-read one; a pipeline with one such read is unchanged.
- A write of `false` through the ganged id reaches every member address (resolve each address's value as the run does; reuse how `knownToSpeaker.defaultsOff.int.test.ts` or the panel tests read a resolved value), and `clearOption` returns all to the default; one write inside a session scope reaches every member in the session's registration values; a mixed state (one member written per address directly) shows the majority value and the words with the right ‹n›.
- The settings form (admin) shows one field for Story's reply; its write reaches every member.
- **Re-pin** (lane fnd-4 just pinned these): `config/panel/index.int.test.ts` `LANE_OWN` (~1048) and the relaxed label check (~1109–1111: restore the strict check by taking `knownToSpeaker` out of the per-lane label sweep, and assert instead that each lane still declares it as a storage address while the panel shows one ganged option); `boot/lorebookTriggerControls.int.test.ts` (~110) and `boot/retrievalModeCull.int.test.ts` (~64, ~73): these pin `declarations()`, which is unchanged; touch them only where a comment or assertion now says something untrue. List every change old → new.

Run, one at a time, each preceded by `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, from the app root:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-5-w2-<n>.log 2>&1"`
Run the files you touched plus `config/panel/groups.int.test.ts`, `sessionValues.int.test.ts` and `sockets/pipelines.scoping.int.test.ts` as regressions. An int test that opens a DB inside an `it` needs a 60 s timeout. Read each log's summary (`tail -n 40`). Do not run `tsc` or `npm run check` (the supervisor runs them).

## Report (your final message)

Changed files; the names you added; where the control sits in each shipped pipeline (slug → step heading); the atomicity and locks findings; tests run with pass counts and log paths; the re-pins old → new; **Noticed, not done**. Under about 450 words.
