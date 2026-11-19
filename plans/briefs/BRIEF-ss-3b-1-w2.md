# BRIEF — `ss-3b-1` worker 2 — the Step 0 table as a test, and the form and the panel agreeing

App repo `/home/jody/github/serene-pub`. Supervisor: lane `ss-3b-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: run **no git command that changes the index or the working tree** (no add, reset, checkout, restore, stash, commit). **No SDK edit or build.** No migration. Never `prettier --write`. Inside `db.transaction(async (tx) => …)` use only `tx`. Use absolute paths. **Tests only, no production code** — if a test shows production code is wrong, stop and report it; do not fix it.

## What already exists (worker 1, done)

`src/lib/server/pipelines/entities/prompts.ts` now has the ONE function that decides which prompts a model call (a step's `prompts-ref` slot) offers, called by both the Pipelines panel (`choicesFor`, `config/panel/choices.ts`; `read.ts` ≈ 574) and the session settings form (`sessions/settingsForm.ts` ≈ 820–845):

```ts
promptDefaultsOf(decls, defaults: ReadonlyMap<string, unknown>): Map<string, number>   // prompts-ref addresses only
promptsOffered(pool, { specId, address, defaults, inForce, showHidden }): T[]
```

Rules (owner note 37, 2026-10-02: "Prompts need to be properly filtered by pipeline across the app"; owner D59, 2026-11-16: "A call offers only the prompts made for its own pipeline, plus its default"; the lead's reading of D59 within one pipeline):
1. a prompt made for another pipeline (`createdForSpecId` set, not this spec) is dropped;
2. a prompt made for this pipeline is dropped when another call of the same pipeline has it as its shipped default;
3. a prompt recording no pipeline (`createdForSpecId == null`) is never dropped by 1–2;
4. kept whatever 1–2 say: the prompt in force and this call's own default;
5. hidden prompts (R54) dropped for a non-admin unless in force.
Defaults = `shippedConfigValuesOf` (`config/named.ts` 618) through `promptDefaultsOf`. Read `promptsOffered` and `promptDefaultsOf` before writing.

Today the form shows **one** prompt row: Story's reply (`core:spec/story-respond`), the only step with `expose.promptReach === 'owner'` (gate at settingsForm ≈ 566). Do not change that.

## Task 1 — the Step 0 table, pinned: new `src/lib/server/pipelines/entities/promptsOffered.int.test.ts`

Set up exactly as `src/lib/server/sessions/settingsForm.int.test.ts` 1–83 does (mock `$lib/server/db` with `createTestDb`, a temp data dir removed in `afterAll`, `bootstrapPipelines`, `createTestUser`, a lorebook, a session row). `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`.

1. **Every shipped genre and preset:** every `session_presets` row after boot (core's: those the boot seeds), one session each with the preset's `genreId`; plus one session (presetId null) for each core genre that has no preset. Pick the session's `primaryRuleset` / `rigour` the way a real session of that genre gets them (find how the session-create path or the genre declares its default ruleset); if you cannot find it in ~10 minutes, use what `settingsForm.int.test.ts` uses and say so.
2. **The pipelines it runs:** `effectiveRegistrations(db, sessionId)` (`pipelines/registrations/resolve.ts` 371) → each distinct `pipeline` with its trigger families (reply / event / action / routine; the `sessionEvents.sessionCreated` one is "create").
3. **Each call with a prompts slot, as the session's owner sees it in the panel:** `namespaceView(db, SECRET, slug, { userId: ownerId, isAdmin: false, sessionId })` (`config/panel`), `groupOptions(view.groups)` (`config/panel/groups.ts` 573), the `prompts-ref` options. Match each option to its declaration with `optionId(SECRET, d.nodeKey, d.slot, d.path)` (`config/panel/ids.ts` 25) over `declarations(db, specVersionId)` (`published(db, slug)` gives the version) so each row carries the `nodeKey`. Offered = `option.choices` labels; in force = the choice whose id is `option.value`.
4. **Before, for the counts (printed, not pinned):** the raw pool size `listPrompts(db, d.nodeDefinitionId, d.slot).length` (what the form offered before) and the note-37-only list (raw pool minus rows with `createdForSpecId` set and ≠ this spec, keeping in force and own default) — what the panel offered before.
5. **The administrator's screens outside a session:** `namespaceView(db, SECRET, slug, { userId: adminId, isAdmin: true })` for each pipeline; for each prompts-ref option, the names in its note-37-only list (computed against that view's `value`) that are NOT in its `choices` — the choices rule 2 removed from an administrator's screen. Pin that list (`REMOVED_ON_ADMIN_SCREENS`), deduplicated by pipeline + nodeKey.
6. **Table row:** `{ genre, preset (seedKey or "(none)"), pipeline (slug), triggers, nodeKey, call (option.step.heading + " · " + option.label), offered: string[] (names, in the panel's order), inForce: string | null, row: offered.length >= 2 }`. Sort rows stably (genre, preset, pipeline, nodeKey).
7. **Stops, as assertions (with a message listing every offender):** (a) no card — one pipeline in one preset — has more than 8 rows; (b) no call's offered list contains a prompt that is another call's shipped default in the same pipeline, other than its own default or the one in force (compute with `promptDefaultsOf(decls, await shippedConfigValuesOf(db, at.specId, at.slug, at.specVersionId, decls))`). If either fires, **leave the assertion failing and report it** — it is a stop for the owner, not something to fix.
8. **Pin:** first run printing the table (`console.log(JSON.stringify(table, null, 1))` — it lands in the log), then write it into the test as a literal `EXPECTED` and assert `toEqual`. Pin names, never ids. Also print the before → after counts per call (raw → note-37 → offered) as one line each.

## Task 2 — the form and the panel agree: `src/lib/server/sessions/settingsForm.int.test.ts`

Add one test inside `describe("the reply's prompt is the owner's to choose (R54)")` (≈ 1132). Do not change the existing tests. In one Story session (`makeSession()`):
- the reply's form **Prompt** row members (keys) equal, as a set, the `choices` ids of the panel's prompts-ref option for the same step (`namespaceView` for `REPLY` with `{ userId: owner, isAdmin: false, sessionId }`, matched by `optionId` from the field's `address.nodeKey`/`slot`/`path`), for the owner and for an administrator viewer;
- create two prompts in the same pool (`createPrompt`, `entities/prompts.ts` 292; pool = the row's declaration's `nodeDefinitionId` + `slot`; a unique name each; copy `fields` from an offered prompt): one with `createdForSpecId` = another shipped spec's id, one with the reply's own spec id. The first is in neither list; the second is in both. A form write (`updateSetting`) of the first is refused with `SettingRefusal`. Delete both in `finally` (`deletePrompt`).
- Settle session events at the end, as the existing test does.

## Files owned

`src/lib/server/pipelines/entities/promptsOffered.int.test.ts` (new), `src/lib/server/sessions/settingsForm.int.test.ts` (the one new test only).

## Out of scope

Any production code; any other test file; docs; NOMENCLATURE.

## Run (one at a time, each exactly like this; never pipe vitest into `head`)

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <ONE PATH> > plans/ss-3b-1-<n>.log 2>&1"
```
`<n>` from 2 upward. Run: the new int test (as often as you need to pin it), then `src/lib/server/sessions/settingsForm.int.test.ts`, then `src/lib/server/pipelines/config/panel/index.int.test.ts` (do not edit it: if it fails, report the failing test, its assertion and whether it is caused by the new rule). `npx prettier --check` your two files (report; no `--write`).

## Report

Final message: the full table as pinned (genre → preset → pipeline → call → offered names → row), the before → after counts per call, `REMOVED_ON_ADMIN_SCREENS` in full, whether the two stops held, test results per file (pass/fail counts, log names), anything that surprised you, **Noticed, not done**. Under 700 words.
