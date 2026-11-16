# BRIEF — worker `time-t5b-w1` — SDK: Beginning and Decay defaults on entry types, the create outlet's two params

Supervisor: lane `time-t5b` (`plans/briefs/BRIEF-time-t5b.md`). Repo for this task: `/home/jody/github/serene-pub-sdk`
(the SDK; the app is `/home/jody/github/serene-pub`). Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You do not run `sdk:build` at all** (the supervisor does). Never `git checkout`, `git restore`, `git stash` or `git clean` in
the SDK repo: most of it is uncommitted. Never `kill -9`. Another session shares this checkout: edit only the files below.

## Goal

When a session creates a new lorebook entry, its **Beginning** (Perpetual, or Began at the session's story date) and its
**Decay** rate (0–1) will come from layered defaults: the entry type's default ← (a genre override, not built here) ← the
writing step's params. This task is the SDK half: the entry type's two optional defaults (core's types and a ruleset's), and
the two params on the lore-writing outlet. The app half (the resolver, the host) is another worker's.

## Owner rulings this depends on (verbatim)

- 2026-11-13: "determine what entry types are created as perpetual vs living by default and also allow overrides in the SDK
  so genres/pipelines etc can override our sensible defaults"; "add the perpetual/living parameter to the entry types defined
  in rulesets"; the rate is "a value between 0 and 1".
- 2026-11-14, §8 item 4: "Core defaults when a dated session writes a new entry: World lore, Place, Character lore =
  perpetual fact; Item = began, fact; History = its own date, living (slow)." **Corrected for this lane:** History declares
  **no** default at all (no Beginning, no Decay): the History question is with the owner. Do not add anything to History.
- The plan's Write rule: "never the model's choice" — so the step's values are **params**, never in-ports (an in-port could
  be wired from model output; a param cannot; a preset may set a param).
- Standing: "SDK should feel like Drizzle" (typed, predictable, one way, refuses early); "Removing or renaming a published SDK
  name is the owner's call" (you only add optional names, each marked `@experimental` and 🚧); catalogue ids evolve in place
  at `@1` — no `@2`.

## Rules quoted from the canon

- NOMENCLATURE R1 "One word, one meaning." R3 "Qualify, never abbreviate to the bare noun." `written` is already the write
  result's word (`outlets.ts` ~1873), which is why the value is `"began"` (the owner's label is "Began at").
- R6: mark provisional vocabulary 🚧. Every new name gets `@experimental` in its JSDoc and a 🚧 in the comment.
- SDK CLAUDE.md: "Display formats … belong to widget settings and templates, never to SDK declaration fields."
- Comments state the rule, not the story (no "added in lane …", no history).
- No other product's name anywhere. It is a **session**, never a chat.

## Build

### 1. The entry type's two defaults — `sdk/src/descriptors.ts`

On `EntryShape` (~3242–3268), add two optional fields, each with JSDoc (`@experimental`, 🚧):

```ts
/** 🚧 Whether an entry a session creates begins at the session's story date ('began') or has always been true
 *  ('perpetual'). Applied once, at creation; a person's later setting always wins. Absent: perpetual. … @experimental */
defaultBeginning?: 'perpetual' | 'began'
/** 🚧 The Decay rate, 0 (a fact) to 1, an entry a session creates starts with. Absent: 0. … @experimental */
defaultDecayRate?: number
```

Say in the JSDoc: the layers are the entry type's default ← a genre's override ← the writing step's params (as declared or as
a preset sets them); a person's own entry is untouched; the Beginning is set only when the session reads at a story date on a
lorebook with its timeline on, the Decay whatever the timeline.

`EntryShape` is hashed whole: core's types republish under the same id with a new hash. That is expected; do not bump `@1`.

In `assertEntryShape` (~3359) add three refusals (throw, like its others; sentences end with a fix):
- `defaultBeginning` not `'perpetual'` or `'began'`:
  `` `${id} declares defaultBeginning '${v}'. Say 'perpetual' or 'began', or leave it out.` ``
- `defaultDecayRate` not a finite number in 0–1:
  `` `${id} declares defaultDecayRate ${v}. A Decay rate is a number from 0 to 1: 0 is a fact, above 0 a living entry.` ``
- `defaultBeginning` (either value) on a type whose `fields` declare any of `year`, `month`, `day` (its entries carry their
  own date, as History's do, so a Beginning default would do nothing):
  `` `${id} declares defaultBeginning, but its entries carry their own date (its fields declare ${parts}), so a Beginning default would do nothing. Leave it out.` ``

A declaration with neither field behaves exactly as today.

### 2. A ruleset's entry types — `sdk/src/rulesetSections.ts`, `sdk/src/repertoires.ts`, `sdk/src/rulesets.ts`

A ruleset's entry type is declared in two shapes: `RulesetEntryTypeDecl` (the sections shape, `rulesetSections.ts` ~349) and
the ⏳ repertoire (`RepertoireProps` / `RepertoireDecl`, `repertoires.ts` ~381–438; core's own rulesets still use it,
`core-catalog/src/registry/rulesets.ts`). Add the same two optional fields, same names, same types, to **both**, and carry
them across every conversion between the two (`aliasEntryTypes` ~1056, `_entryTypeAsRepertoire` ~1281, and whatever
`defineRepertoire` / `defineRuleset` copy — find it and make sure the fields survive), **absent when unstated** so a ruleset
that says nothing hashes exactly as before. In `rulesetEntryTypeDecls` (`rulesets.ts` ~801) copy them onto the derived
`EntryTypeDecl` in **both** branches (sections and ⏳ repertoires) when present.

Findings (collected, the way each file already reports): in `rulesetEntryTypeFindings` (`bad-entry-type`, the existing
reason) and in repertoire `ownFindings` (a reason name of the file's style; propose one, e.g. `bad-entry-default`, and say it
in your report), refuse a `defaultBeginning` that is not `'perpetual'`/`'began'` and a `defaultDecayRate` outside 0–1, with
the same sentences as step 1 but naming the ruleset path (`${at}`). The date-carrying refusal is enforced by
`assertEntryShape` when the derived type registers; no ruleset type declares `year`/`month`/`day` today.

### 3. Core's own types — `core-catalog/src/registry/entries.ts`

Declare the ruled defaults:
- `worldLoreEntryType`, `characterLoreEntryType`, `locationEntryType` (Place): `defaultBeginning: "perpetual"`, `defaultDecayRate: 0`.
- `itemEntryType`: `defaultBeginning: "began"`, `defaultDecayRate: 0`.
- `historyEntryType`: nothing.
- `ENTRY_UNIVERSAL_PARTS`: nothing (a ruleset's types default to absent = perpetual, 0 unless the ruleset says).

### 4. The lore-writing outlet — `contracts/src/outlets.ts`

On `createLoreEntry` (`core:outlet/create-lore-entry@1`, ~1803), add two params beside `entryType` in `slots.params.schema`,
neither with a `default` (absent = the layer below decides), neither `quick`:
- `defaultBeginning`: an enum of `perpetual` | `began` in the one field language (look at how other outlet/step params
  declare an enum with option labels, and copy that form). Label 🚧 *New entry's beginning*; options *Perpetual* /
  *Began at*; description 🚧 *Whether an entry this step creates begins at the session's story date (Began at) or has always
  been true (Perpetual). Left empty, the entry type's own default applies.*
- `defaultDecayRate`: a number, min 0, max 1. Label 🚧 *New entry's decay*; description 🚧 *The Decay rate an entry this step
  creates starts with: 0 is a fact, above 0 up to 1 a living entry. Left empty, the entry type's own default applies.*

If the field language or a validator wants more (a group, a purpose), follow what the existing `entryType` param does and
report what you found. In the outlet's JSDoc, add a short `## Beginning and Decay of a new entry` section: the two params
(params, never ports, so a model's output cannot reach them; a preset may set them), the layer order (the entry type's default
← a genre's override ← these params), applied only when the write **creates** an entry (never a match, an update or a history
day), the Beginning only when the session reads at a story date on a lorebook whose timeline is on, the Decay always.

Fix three JSDoc passages so they say what the host does (the host's facts: under **Full** on the owner's own lorebook a
session writes to the lorebook whether or not its scenes end by themselves, `host.ts` ~1630–1632):
- `## Where the write lands` (~1765–1769): replace the paragraph so it says: under **Full** on the owner's own lorebook the
  write lands in the lorebook (a change to an existing entry as the version at the session's date when it reads at one),
  whether or not the session's scenes end by themselves; under Review changes, Off or on a book someone else owns it lands in
  the session's own book, and the result then carries `route: "own-book"` and the own book's `lorebookId`. Keep the existing
  sentence about a history write on the own-book route filing onto the own book's day.
- The `shown` port's JSDoc (~1874): "A change to an existing entry goes where such changes go (a held change for a lorebook
  entry, in place for an own-book one)" → use this sentence, queued by lane time-t5a: *a change to an entry of the lorebook
  is written there under **Full** on the owner's own lorebook (as the version at the session's date when it reads at one),
  and otherwise kept in the session's own book as a held change until applied.*
- `updateLoreEntry`'s JSDoc (~1908–1913), "A change to an entry of the lorebook the session reads is kept in the session's
  own book as a held change whatever the lorebook's write mode (**Full** too)…": rewrite with the same queued sentence;
  keep the own-book half.

### 5. Tests — new `sdk-tests/entryDefaults.test.ts` (node:test, like its neighbours; read `entries.test.ts` and
`rulesetEntryTypes.test.ts` first for the style)

- core's world lore, character lore and place declare perpetual / 0; item declares began / 0; history declares neither;
- `describeEntryType` refuses each of the three bad declarations (assert on the sentence); a declaration with neither
  field registers as before;
- a ruleset in sections whose entry type declares the two defaults derives an entry type carrying them; one in the ⏳
  repertoire shape does too; a ruleset that declares neither derives a type with neither (and its declaration hash is
  unchanged by this work — compare to a hash taken without the fields if the file's helpers make that easy; otherwise
  assert the keys are absent);
- a ruleset entry type with a rate of 1.5 or a beginning of `'written'` is refused with the finding;
- `createLoreEntry`'s params declare `defaultBeginning` and `defaultDecayRate`, and neither is an in-port.

### 6. SDK guides

- `guides/rulesets.md`, in **3. Entry types and zone types** (~135): one short paragraph and a one-line code example of an
  entry type declaring `defaultBeginning: 'began'` and a `defaultDecayRate`, saying what they mean (as in the JSDoc), that
  they apply only to an entry a session creates, and that a person's later change wins.
- `guides/writing-lore-from-a-pipeline.md`, after **Choosing an entry type**: a short section *Beginning and decay of a new
  entry* (🚧): the two params, the layer order including a preset, applied on creation only, the Beginning only at a story
  date on a lorebook with its timeline on. **Do not** say that a living entry shows a time delta, or that recall uses Decay:
  neither is built. If a code block goes in a guide, check whether `guideSnippets.test.ts` / `docsExamples.test.ts`
  compile guide blocks and keep it compiling.

## Files owned (edit only these)

`/home/jody/github/serene-pub-sdk/sdk/src/descriptors.ts` (EntryShape and assertEntryShape only),
`sdk/src/rulesetSections.ts`, `sdk/src/repertoires.ts`, `sdk/src/rulesets.ts` (only what step 2 needs),
`core-catalog/src/registry/entries.ts`, `contracts/src/outlets.ts` (createLoreEntry params, the three JSDoc passages),
new `sdk-tests/entryDefaults.test.ts`, existing SDK tests only if a pin moves **on purpose** (re-pin with a dated comment
saying why: "2026-11-15: core entry types declare Beginning/Decay defaults"), `guides/rulesets.md`,
`guides/writing-lore-from-a-pipeline.md`.

**Not** `sdk/src/genres.ts` (the genre override is held for the owner), not `fit.ts`, not `INTEGRATING.md`, nothing in the app.

## Stop and report (do not decide) when

A published name would have to change; the fields cannot survive `defineRepertoire`/`defineRuleset` without changing an
existing name; a ruleset that declares nothing would hash differently; anything outside the files above seems needed.

## Done means

Targeted SDK tests, one run at a time, capped, from the sdk-tests dir (this is node:test via tsx, not vitest):

    systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test entryDefaults.test.ts entries.test.ts rulesetEntryTypes.test.ts rulesetSections.test.ts rulesets.test.ts loreBuilders.test.ts guides.test.ts guideSnippets.test.ts docsExamples.test.ts > /home/jody/github/serene-pub/plans/time-t5b-w1-1.log 2>&1"

and `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit` (log to `plans/time-t5b-w1-tsc.log`). Never pipe
test output into `head`. Known failures elsewhere in the suite (not yours): `deriveDontSpell` ×2, `surface` untagged exports,
`vocabulary` in `your-first-plugin.md`. `npx prettier --check` on each file you edited (report, don't mass-reformat).

## Report

Your final message: changed files; every new published name with its doc sentence; the finding reason you chose; the
param schema form you used; tests run with results (log paths); anything you stopped on; **Noticed, not done**.
