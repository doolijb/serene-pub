# BRIEF — worker `time-t5b-w4` — docs and names: what a session's new entry starts with

Supervisor: lane `time-t5b` (`plans/briefs/BRIEF-time-t5b.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You run no tests and no builds. Never `git checkout` / `restore` / `stash`. Another session shares this checkout: edit only
the three files below, and in `NOMENCLATURE.md` only the places named.

## What was built (the facts to document — do not document anything beyond them)

- When a **session creates a new lorebook entry** (through the lore-writing outlet, `core:outlet/create-lore-entry@1`), in
  **every write setting** (Full, Review changes, Off, a book someone else owns) and so on both routes (straight into the
  lorebook, or into the session's own notes, where **Apply** later moves the entry with its values), its **Beginning** and
  **Decay** are set once, at creation, from layers: the **entry type's default** ← the **writing step's** values (the
  outlet's params `defaultBeginning` and `defaultDecayRate`, as the pipeline declares them or as a preset sets them). Never
  the model's choice (they are params, which a model's output cannot reach).
- Core's types: **World lore**, **Character lore** and **Places** start *Perpetual · Fact*; an **Item** starts *Began at* the
  session's story date · *Fact*. **History** entries are untouched (dated by their day, as before; no default declared).
  A ruleset's entry type may declare its own two defaults (`defaultBeginning: 'perpetual' | 'began'`, `defaultDecayRate`
  0–1); one that says nothing starts Perpetual · Fact.
- The **Beginning** is set only when the session reads at a story date on a lorebook with its **timeline on**; with the
  timeline off or no story date, nothing gets a Beginning. The **Decay** applies whatever the timeline.
- **Untouched:** a person's own new entry (still *Perpetual · Fact*), an import, a duplicate, a starter lorebook's copy, a
  change to an entry that already exists (including a write that matches an existing entry), a history day. A person's
  later change always wins; nothing existing was changed (no backfill).
- Undo: **Back**, a swipe or a regenerate takes the new entry away with its turn, as before.
- A step's bad value is refused with a sentence and nothing is written: *‹value› is not a Beginning default. Say
  'perpetual' or 'began', or leave it empty.* · *A Decay rate is a number from 0 to 1: 0 is a fact, above 0 a living
  entry.* · *History entries carry their own date, so defaultBeginning does nothing here. Leave it empty.*
- **Not built** (never write that it is): a **genre** override of these defaults (its place in the genre declaration is a
  question for the owner); recall using Decay; a living entry's prompt text showing how long ago it was true (a "time
  delta"); any History default. The entry row still says Decay is *Stored now; recall does not use it yet.*
- SDK names (all 🚧, `@experimental`): `EntryShape.defaultBeginning` (`'perpetual'` | `'began'`) and
  `EntryShape.defaultDecayRate` (0–1), the same two on a ruleset's `RulesetEntryTypeDecl` and on the ⏳ repertoire
  (`RepertoireProps` / `RepertoireDecl`); the repertoire finding reason `bad-entry-default` (a section entry type uses the
  existing `bad-entry-type`); the declaration refusals *‹id› declares defaultBeginning '‹v›'. Say 'perpetual' or 'began', or
  leave it out.* · *‹id› declares defaultDecayRate ‹v›. A Decay rate is a number from 0 to 1: 0 is a fact, above 0 a living
  entry.* · *‹id› declares defaultBeginning, but its entries carry their own date (its fields declare ‹parts›), so a
  Beginning default would do nothing. Leave it out.*; the outlet params `defaultBeginning` (label *New entry's beginning*,
  options *Perpetual* / *Began at*) and `defaultDecayRate` (label *New entry's decay*). R1: the value is `began`, not
  `written` (`written` is the write result's word); the owner's label is *Began at*. Core's four types' content hashes and
  the outlet's moved under the same `@1` (re-pinned in `registryHashes.test.ts`).
- App names (internal, 🚧): `lorebooks/entryDefaults.ts` — `newEntryTime` (the one resolver: per field, step ← genre ← entry
  type, else perpetual and 0; the host passes no genre layer), `checkStepDefaults`, `entryTypeDefaultsLayer`,
  `entryTypeSentenceName`, types `EntryDefaultsLayer`, `BeginningDefault`, `NewEntryTime`; applied only in `host.ts`'s
  `create-lore-entry` new-entry insert, the date from `sessionReadingOf(...).moment`. `IdMaps.amendments`
  (`lorebooks/tableRegistry.ts`): the dated-changes copy's id map, so **Fold in parent** moves a session's per-turn record
  of an **entry version** (`lore_imprints.subject_kind` `version`) to the copy of its amendment (`foldInParent.ts`).

## Owner rulings to quote where a row cites them

2026-11-13: "determine what entry types are created as perpetual vs living by default and also allow overrides in the SDK so
genres/pipelines etc can override our sensible defaults"; "add the perpetual/living parameter to the entry types defined in
rulesets". 2026-11-14 (§8 item 4): "Core defaults when a dated session writes a new entry: World lore, Place, Character lore
= perpetual fact; Item = began, fact". Go: 2026-11-15 "proceed with everything in the order you see fit".

## Build

1. `docs/lorebook-time.md`, section **Beginning and decay** (~78–91): one short paragraph (🚧) *What a session's new entry
   starts with*, from the facts above, with one example in the file's style: a session standing at Year 12 writes a new item,
   the Brass Key; it starts *Began at Year 12 · Fact*, so a session at Year 10 doesn't read it; a new world lore entry from
   the same session starts *Perpetual · Fact*. Say that a person's later change wins, that the timeline off sets no
   Beginning but keeps the decay, and that history entries keep their own date. **Do not** say a History entry is living, that
   recall uses Decay, or that a time delta is shown.
2. `docs/lorebooks.md`, **What a session may write** (~216): one or two sentences after the list of write settings (not
   inside a bullet): a new entry a session writes, under any setting, starts with its type's Beginning and Decay (link to
   `./lorebook-time.md#beginning-and-decay`); under Review changes or Off it keeps them when applied.
3. `NOMENCLATURE.md`:
   - The **Beginning** row (§8, ~383): in **Does not own**, replace "what a session writes (lane T5)" by a clause in
     **Owns** or a new sentence: 🚧 2026-11-15 (lane time-t5b) the default a session's new entry starts with — the entry
     type's `defaultBeginning` ← the writing step's param, resolved by `newEntryTime`, set only at a story date on a lorebook
     with its timeline on, once, at creation; a genre's override not built. Keep the row's style (bold labels, ⚠ lines).
   - The **Decay** row (~384): in **Does not own**, replace "defaults per entry type or genre (lane T5)" similarly: the
     entry type's `defaultDecayRate` ← the step's param, whatever the timeline; a genre's override not built.
   - §25 Change ledger: one dated bullet at the end of the dated-bullet list (after the 2026-11-15 `time-t5a-fix` bullet,
     ~4282; check what follows it and keep the order by date): **2026-11-15 (lane time-t5b — owner rulings 2026-11-13 …,
     2026-11-14 §8 item 4; go 2026-11-15)** listing every new name above (SDK, outlet params with their labels, finding
     reason, sentences, app names, `IdMaps.amendments`), the R1 note on `began`, and that the four core types' and the
     outlet's hashes moved under `@1`. Say "a genre's override: not built, held for the owner".
4. Style: every line you add states the rule, not the story; short sentences; it is a **session**, never a chat; never
   write "no lorebook"; no other product's name. Mark provisional things 🚧 as the surrounding text does.

## Files owned (edit only these)

`docs/lorebook-time.md`, `docs/lorebooks.md`, `NOMENCLATURE.md` (the two rows and the §25 bullet only).

## Done means

The three edits made; `npx prettier --check` is not needed for markdown here. Report the exact text you added (each
paragraph/clause), so the supervisor can check it.

## Report

Your final message: changed files, the text added, anything you stopped on, **Noticed, not done**.
