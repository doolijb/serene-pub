# BRIEF — build lane `time-t5b` — Beginning and Decay defaults for entries a session writes (SDK + core)

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` (the owner's words at the top, §1, the **Write** paragraph ~107,
§6 row T5, §8 item 4), `plans/briefs/BRIEF-time-t5a.md` (Build D and correction 5: what was moved here),
`plans/REPORT-time-t5a-2026-11-15.md` (all; its **Queued** section is this lane's), `plans/REPORT-time-t2-2026-11-14.md`,
`../serene-pub-sdk/INTEGRATING.md` (the steps on entry types, ruleset repertoires, genres and the lore-writing
outlet), `docs/lorebook-time.md`, `docs/lorebooks.md` (writes from sessions), `NOMENCLATURE.md` §1, §24, §23 and
the rows **Beginning**, **Decay**, *entry type*, *repertoire*, *outlet*.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite"` (dev **and** preview) for a serene-pub server and
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` for a test run. If either is up, don't build; report
'blocked on your dev server'.

## Goal

When a **session** writes a **new** lorebook entry at a story date (Full writes on a lorebook with the Timeline
on), the entry's **Beginning** and **Decay** come from layered defaults, never from the model's choice:

    the entry type's default (core's, or a ruleset repertoire's)  ←  the genre's override  ←  the writing step's value

A person's hand-made entry is untouched (perpetual, Fact), as today. A person's later setting always wins: the
defaults apply once, when the entry is created.

## Owner rulings (quote them in worker briefs)

- 2026-11-13: "determine what entry types are created as perpetual vs living by default and also allow overrides
  in the SDK so genres/pipelines etc can override our sensible defaults"; "add the perpetual/living parameter to
  the entry types defined in rulesets"; the rate is "a value between 0 and 1".
- 2026-11-14 ("Lets go with all your recommendations"), §8 item 4: "Core defaults when a dated session writes a
  new entry: World lore, Place, Character lore = perpetual fact; Item = began, fact; History = its own date,
  living (slow)."
- The plan's **Write** rule: "never the model's choice".
- 2026-11-15: "proceed with everything in the order you see fit" (the go); "Time Delta, keep a recipe for using
  recency in the SDK in the docs" (lane `time-t7b`, built before this one: a living entry's prompt text starts
  with how long ago it was last true; recall does not rank by Decay).
- Standing: P1; P5; "Removing or renaming a published SDK name is the owner's call" (adding `@experimental`
  optional names is within the go: list every one); "SDK should feel like Drizzle"; "0.6 is in users' hands"
  (no stored data changes here: defaults apply to new entries only; **no backfill**); "Rulesets are stateless".

## Build

### A. Inventory first (supervisor, read-only) — report with file:line

1. Where an entry type is declared: core's own types and a ruleset repertoire's (`contracts`, `sdk`,
   `core-catalog`), what optional fields a declaration already carries, and how the app reads a type's
   declaration when a session writes an entry (`src/lib/server/pipelines/runtime/host.ts` lore write route,
   `src/lib/server/lorebooks/ownBook.ts`, `entryVersions.ts`).
2. Where a genre can state an override per entry type today (a genre declaration's fields about lore or entry
   types), and the smallest additive place for one.
3. The lore-writing outlet's values (`../serene-pub-sdk/contracts/src/outlets.ts` ~1874–1913): how a step passes
   optional values with a write, and how they are validated (a model-produced value must not be able to set
   these: say how the outlet tells a step's declared value from model output).
4. What "began" means at write time: the session's story date as the entry's Beginning date parts (as lane
   `time-t2` stores them; `utils/lorebookEntries.ts` `takesBeginning`, `sockets/entries.ts`
   `assertBeginningHolds`), and what a History entry already does with its own date.
5. `src/lib/server/lorebooks/foldInParent.ts`: how per-turn records are re-keyed when a line folds into its
   parent, and what a `version` record (lane `time-t5a`, `imprints.ts` `SUBJECTS.version`) needs there.

### B. SDK (additive, every new name `@experimental`)

- On an **entry type declaration** (core's and a repertoire's): two optional defaults — whether a new entry
  **begins** at the writing date or is perpetual, and its **Decay rate** (0–1). Names by NOMENCLATURE §24 and R3
  (qualified, never the bare noun); lead's proposal 🚧 `defaultBeginning: "perpetual" | "written"` and
  `defaultDecayRate: number`. Validation: rate within 0–1; a declaration with neither behaves as today.
- A **genre override** keyed by entry type id, same two values, in the place inventory item 2 finds.
- Two optional values on the **lore-writing outlet**, set by the step's declaration, never by model output.
- Fix the outlet JSDoc queued by `time-t5a` (the sentence is in its report's **Queued** section).
- Core's own types declare the ruled defaults: World lore, Place, Character lore = perpetual, 0; Item = begins
  when written, 0; History = its own date, living at a **slow** rate. The number for "slow" is a ★ (propose one
  with its reason: what the delta and a recipe-style fade would do with it; say it in the report; default to
  0.1 🚧 if nothing better follows from the code).
- SDK tests for the declarations, the validation, the layering order.

### C. App

- One pure function resolves the layers (type ← genre ← step) and is the only place that does. It is applied
  only on a **session's creation of a new entry at a story date on a Timeline lorebook**; never on a person's
  write, an import, a duplicate, a starter, the session's notes, or an update to an existing entry.
- With the Timeline off or no story date: nothing is set (perpetual, 0), whatever is declared.
- The created entry's values are visible on its row at once (the entry row from lane `entry-form-layout`), and
  the per-turn record's undo removes the entry as today (nothing new to undo).
- `foldInParent.ts`: re-key `version` records (the queued fix), with a test.

### D. Docs and names

`docs/lorebook-time.md` (what a session's new entry starts with, one example: an Item written on a date begins
on that date; a History entry is living), `docs/lorebooks.md` (writes from sessions), the SDK's reference or
guide page where entry types and repertoires are documented, `NOMENCLATURE.md` (the **Beginning** and **Decay**
rows: who sets the default, in which order; §25 for every new name). No other product's name.

## Files owned

SDK: the entry type and repertoire declarations and their validation, the genre declaration (the override
only), `contracts/src/outlets.ts` (the two values and the JSDoc), core-catalog's own entry types, tests, the
docs page. App: the session write route in `pipelines/runtime/host.ts` (new-entry branch only), one new small
module beside `lorebooks/entryVersions.ts` for the resolver, `lorebooks/foldInParent.ts`, tests, the two docs,
`NOMENCLATURE.md`.

## Out of scope

Any backfill or change to existing entries; a UI for editing defaults; a setting; ranking; the time delta
(`time-t7b`); cast members; knowledge marks; entry types' other fields.

## Stop and ask when

CLAUDE.md §Decisions applies; a model's output could reach the two outlet values; the override needs a second
place in the genre declaration; a published name would have to change; a migration seems needed (none is
expected); a shipped genre's existing test of a session-written entry changes for a type other than Item or
History.

## Done means

- `npm run sdk:build` from the app root (after the checks above), then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/time-t5b-sdk.log 2>&1"`:
  only the four known failures (`deriveDontSpell` ×2, `surface` untagged exports, `vocabulary` in
  `your-first-plugin.md`).
- App tests (targeted, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t5b-<name>.log 2>&1"`,
  one at a time): the resolver's table (each layer, each absent); a dated session's new Item begins at the
  session's date; a new History entry is living at the declared rate; a new World lore entry is perpetual, 0; a
  genre override wins over the type; the step's value wins over both; Timeline off and no clock set nothing; a
  person's new entry and an update to an existing entry are untouched; a ruleset repertoire's type with defaults;
  the fold re-key; then `src/lib/server/lorebooks`, `src/lib/server/pipelines/runtime/host.*`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t5b-<date>.md`): the inventory with
file:line; every new published name with its doc sentence; the number chosen for "slow" and why; changed files
in both repos; when you ran `sdk:build`; tests with results; open ★; **Noticed, not done**. Under about 800
words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

1. **History stays a Fact in this lane.** §8 item 4 ("History = its own date, living (slow)") was ruled
   2026-11-14, when living meant fading in recall; on 2026-11-15 the owner chose "Time Delta" and no fade, so
   living now means a *(… ago)* delta in the prompt, on an entry that is already shown under its date. The
   question is with the owner (both quotes). Until he answers: core's History type declares **no** Decay default,
   no "slow" number is chosen, and `scenes/historyEntryOfDate.ts` is not touched. Drop the History rows from the
   tests except "a new History entry is created as today".
2. **The defaults apply wherever a session creates the entry, in every write mode.** Neither the plan's Write
   rule nor §8 item 4 limits by write mode; "(Full writes…)" in the Goal and "never on … the session's notes" in
   Build C are **withdrawn**. A new entry made by a session that reads at a date on a lorebook with the Timeline
   on takes the defaults on both routes: straight into the lorebook (`host.ts` ~12164) and into the session's own
   book as a held change (`lorebooks/ownBook.ts` ~399–440, `host.ts` ~1630–1715); Apply then moves the row as it
   is (`ownBook.ts` ~2245–2252), carrying the values. The date comes from the session's reading
   (`sessionReadingOf`), not from the write line (its `moment` is null on the own-book route). Test: the same
   genre and step give the same Beginning and Decay under Full and under Review changes after Apply. Still
   untouched: a person's write, an import, a duplicate, a starter, an update to an existing entry.
3. **Timeline off or no story date: only the Beginning stays unset. Decay still resolves from the layers** (★7,
   2026-11-14: "Decay with a timeline: story time…; without: rounds"; Decay is shown and kept with the Timeline
   off, `docs/lorebook-time.md` ~46, ~89).
4. **The SDK shape.**
   - The two defaults are optional fields on the entry type's shape (`sdk/src/descriptors.ts` ~3242–3268,
     `EntryShape`). It is hashed whole, so core's types republish under the same id: expected, no `@2`.
   - The genre override is keyed the way genres already name entry types (`sdk/src/genres.ts` ~251–266,
     `uses.entryTypes {tag,…}`): core types by the declared object, a ruleset's by its repertoire tag
     (`repertoires.ts` ~417). Never by a spelled derived id (`<creator>:entry/…@1` ties a genre to one ruleset).
     If that cannot be done without a second place in the genre declaration, **stop and ask**.
   - The value is `"began"`, not `"written"` (R1: `written` is the write result's word, `outlets.ts` ~1873; the
     owner's label is "Began at"): 🚧 `defaultBeginning: "perpetual" | "began"`, `defaultDecayRate`.
   - A declaration that would silently do nothing is refused with a sentence: a Beginning default (or a genre's
     override of it) on a type that carries its own date (History); a rate outside 0–1.
   - The outlet's two values are **params**, as `entryType` is (`outlets.ts` ~1752–1756, ~1829–1841): an in-port
     could be wired from model output, a param cannot. Params are also settable by a preset: name that layer in
     the docs and in the resolver's order (type ← genre ← the step's params, as declared or as a preset sets
     them).
   - Also fix the create outlet's "Where the write lands" JSDoc (`outlets.ts` ~1767–1769), which still says Full
     sessions whose scenes end by themselves write to the session's own book (the host does not: `host.ts`
     ~1630–1632), with the sentence queued by `time-t5a`.
5. **The fold's re-key.** `copyLorebookTables` copies `entry_amendments` with fresh ids and returns no map
   (`lorebooks/tableRegistry.ts` ~786–810; `IdMaps` ~61–75), so a `version` record cannot be re-keyed from the
   files first listed. `src/lib/server/lorebooks/tableRegistry.ts` is added to Files owned **only** to return an
   amendments id map from that copy (`.returning`), used by `foldInParent.ts`. If that needs more than the map,
   stop and report; do not rule that version records keep naming the parent's rows.
