# BRIEF — hist-C-w1: contract prose, the note-scene outlet, and the SDK docs (scenes first)

Supervisor: lane hist-C. You type; you do not decide names, copy beyond what is given, or behaviour. All edits are in the SDK sibling repo `/home/jody/github/serene-pub-sdk` (most of it is uncommitted; edit with Edit only). Report path: `/home/jody/github/serene-pub/plans/briefs/REPORT-hist-C-w1.md` (if the write is refused, put the report in your final message).

## Owner rulings you apply (2026-11-10, verbatim where quoted)

- **Scenes first:** "encouraging pipelines/modders to be targeting scenes first for granular history updates, then history entries second, optimally compiling from scenes to history entries."
- `core:outlet/note-scene@1` is added now (contract only here; the host half is another lane's).
- **Compile stays a person's press**: pipelines and plugins never run Compile (it runs outside the executor).
- A pipeline's history write files onto its day's one history entry (the session's story-now day when no date is given), **appending a paragraph**. One history entry per date per line.
- No new query nodes. Dated reads are a **docs recipe only**, as an advanced technique.

## Goal

### 1. `contracts/src/outlets.ts`

a. **`create-lore-entry@1`** (JSDoc ~1607-1666, declaration ~1668):
   - In "Which kind of entry" (~1611-1622): the example list of ids becomes `` `core:entry/world-lore`, `core:entry/location` `` (drop history), and the sentence "a summarizer writes history every time it runs, a room-builder writes locations every time" becomes "a room-builder writes locations every time it runs".
   - Add a new JSDoc subsection right after that one: `## History is compiled, not written (2026-11-10)` with exactly this paragraph: *"History is compiled, not written. Put events into scenes (`note-scene@1`, or a story line); a person's Compile files them under the day's one entry. A history write here is the second choice: it files onto its day's entry (the session's story day when no date is given), appending a paragraph."* You may add one sentence after it: "The packager warns `W_WRITES_HISTORY` on such a write; a `summarize-request@1` spec is exempt, its save being previewed."
   - The `entryType` param's `description` (~1695) becomes exactly: `'Which kind of lorebook entry this pipeline writes — world lore or a location. Leave it as world lore for anything that is simply about the world.'` Change nothing else in the declaration.

b. **`update-lore-entry@1`** JSDoc (~1735-1757): add one paragraph before `@internal`: *"🚧 A history entry's re-date (its `year`, `month` or `day` fields) is checked as a person's re-date is: refused, with a sentence, onto a date its line already has a history entry for, or onto a day the line shares with its parent (change that day as an amendment instead)."* JSDoc only.

c. **New outlet `noteScene`** placed directly after `proposeSceneCue` (ends ~799), before the `setStatConfig` JSDoc. Copy the sibling style exactly (`pin(describeOutletDefinition({...}))`, tabs, single quotes, no semicolons):

```ts
/**
 * 🚧 **Note it in the scene** (★S4, owner 2026-11-10): adds a note to a scene — a fact that
 * isn't a story line (a death, a treaty, a clock jump). Notes reach the scene's summary and
 * Compile. Never writes history or messages. Refused when the genre writes no scenes, when the
 * scene is another session's, or when no scene is open.
 *
 * Scenes first: a pipeline puts story events into scenes — this outlet, or a story line through
 * `create-message@1` — and a person's Compile files a day's scenes under that day's one history
 * entry. A history write through `create-lore-entry@1` is the second choice.
 *
 * `text` is required. `scene` names a scene by id; absent, the note goes to the run's lane's open
 * scene. `sources` (optional) are the messages the note was written from, the shape the lore
 * writes take. "The genre writes no scenes" is `writes.scenes: false`. The host half is the app's.
 * @experimental
 * @ruling ★S4 (2026-11-10)
 */
export const noteScene = pin(
	describeOutletDefinition({
		id: 'core:outlet/note-scene@1',
		i18n: { name: { en: 'Note it in the scene' } },
		effects: 'write',
		review: { fields: ['text'] },
		timeoutMs: 10000,
		ports: {
			in: {
				/** The note, a sentence or two. Required. */
				text: S.text,
				/** A scene id. Optional; absent, the run's lane's open scene. `json`, as `propose-scene-cue@1`'s `at` is. */
				scene: S.json,
				/** 🚧 The messages the note was written from — as the lore writes take them. Optional. */
				sources: S.loreSources,
			},
			out: { main: S.writeResult },
		},
	}),
)
```
   Before writing, read `proposeSceneCue` and `createLoreEntry` to confirm every key above exists on sibling outlets (`review`, `timeoutMs`, port JSDoc). If one does not fit (a type error), stop and report; do not invent a different shape. `contracts/src/index.ts` already `export *`s this file, and `pin()` registers it, so no list needs editing; confirm with a grep that no other list in `contracts/src` enumerates outlets.

d. **`update-cast-member@1`** JSDoc (~2105-2125): after the paragraph that ends "Other keys are refused, never dropped.", add: *"🚧 `changes` may also carry `nodeState` — one of `CAST_STATE_WORDS` (`active`, `deceased`, `missing`, `departed`; SDK `ties.ts`) — and `nodeVisibility` — `normal`, `legendary` or `hidden` — beside the profile fields: the member's state and visibility on the graph. Checked against those words (another word is refused, never dropped), and dated at the session's story time and tied to the turn like the profile fields."* Also update the `changes` port's one-line comment to `` /** `{ [profile field]: value | { follow: true } }`, plus `nodeState` / `nodeVisibility` (see above). */ ``. Contract types stay `S.json`; do not touch `review`.

### 2. `sdk/src/variables.ts` (~755): `varCurrentDate`'s `description.en` becomes exactly: `"The story's present date: the session's clock when it is set, else the present of the session's line, else the most recent history entry."` Nothing else in the file.

### 3. `core-catalog/src/registry/entries.ts` (~185-205): in the JSDoc above `historyEntryType` only (NOT its `i18n` text), after "History — dated entries recording earlier events." add a paragraph: *"**Written by Compile from scenes** (2026-11-10). A person's Compile files a day's scenes under that day's one history entry — one per date on each line. A pipeline puts events into scenes (`core:outlet/note-scene@1`, or a story line); a direct history write through `create-lore-entry@1` is the second choice and files onto its day's entry, appending a paragraph."*

### 4. `guides/writing-lore-from-a-pipeline.md`
- New section `## Story events: scenes first` placed **before** `## Choosing an entry type`. Content, in short plain sentences (this guide's voice):
  - Story events (a death, a treaty, the party reaching a town) go into scenes first, not history.
  - Two routes: a story line through `create-message@1`, or `note-scene@1` for a fact that isn't a line. Notes reach the scene's summary and Compile. `note-scene@1` is refused when the genre writes no scenes, when the scene is another session's, or when no scene is open.
  - Compile is a person's press: it files a day's scenes under that day's one history entry. Pipelines and plugins cannot run it.
  - A history write through `create-lore-entry@1` is the second choice. It files onto its day's entry — the session's story day when no date is given — appending a paragraph; a line has one history entry per date.
  - The packager warns `W_WRITES_HISTORY` when a pipeline writes history directly; a `summarize-request@1` spec is exempt because its save is previewed and a person applies it.
- Fix the line under "Updating instead of adding" that reads "Use it for the entry that should exist once, such as a running summary." so a running summary points at world lore or the session annex, never history, e.g. "Use it for the entry that should exist once, such as a running summary kept as world lore (or in the session annex), never as history."
- New section `## Advanced: reading what changed, when` placed before `## What the host does for you`. The ★S5 recipe, docs only: no node does this for you, and nothing ships wired (a genre opts in). Show how to combine the dated reads that already exist into a context template: `core:query/history-entries@1` (the dated history band), `core:query/stat-trail@1` (one stat's values over time — its `mode`, `since: { date }`, `last`), `core:query/lorebook-state@1` with `at` a story date (the world as it stood then, to set beside the head), and the `core:var/current-date@1` variable (the present). Say that entry amendments and cast versions are not readable from pipelines yet. **Verify every id, port, param and band name you write against `contracts/src/queries.ts` and `sdk/src/variables.ts`**, and verify how a query's output reaches an assemble template before you describe it (grep how a spec wires a query's `main` into `assemble`/a template; `sdk/src/templateScopeAt.ts`). Where you cannot verify a step, write less rather than guess, and list it under "unverified" in your report. Prefer prose plus a short ` ```handlebars ` template fence. Any ` ```ts ` fence is type-checked by `sdk-tests/guideSnippets.test.ts`: it must type-check, or be marked ` ```ts nocheck <reason> ` (reason required).

### 5. `guides/genres-presets-and-routines.md`, `## Summaries` (~282-301)
Add a short `### What a summarizer writes` subsection after "### Three ways to register a summary": a summarizer writes a scene, held for review — its save is previewed and a person applies it — and a person's Compile files the day's scenes under that day's one history entry. Keep it 2-4 sentences; link the lore guide's "Story events: scenes first" section in the style the guide already links (check how it links other guides).

### 6. `INTEGRATING.md`
- In `## 1k. Character profile and cast members` (~1360), the `core:outlet/update-cast-member@1` bullet: add that `changes` may also carry `nodeState` (`CAST_STATE_WORDS`) and `nodeVisibility` (`normal`/`legendary`/`hidden`), checked against those words and dated/anchored like the profile fields; the checker is the app's.
- Add a new short section after 1k's last bullet and before the `---` that precedes `## 2.`: `## 1l. Story events: scenes first (2026-11-10)` with `🚧 Declared in the SDK (lane hist-C); the host half is the app's.` and bullets:
  - The rule (the owner's sentence, quoted).
  - `core:outlet/note-scene@1`: in `text` (required), `scene` (optional scene id; else the lane's open scene), `sources`; out `main`; review on `text`; refused when `writes.scenes: false`, the scene is another session's, or no scene is open; never writes history or messages; notes reach `summarize-request@1` and Compile. The host stores them on the scene (the app's).
  - `create-lore-entry@1` with a history `entryType`: the second choice; the host files it onto the day's one entry (story-now day when undated), appending a paragraph. `update-lore-entry@1`: a history re-date is checked as a person's.
  - Compile is a person's press, closed to pipelines and plugins.
  - The packager warning `W_WRITES_HISTORY` (warning, not error): a `create-lore-entry` node whose resolved `entryType` is `core:entry/history`; specs on `core:inlet/summarize-request@1` exempt. `entryType` resolves through the SDK's `declaredNodeParams(doc, nodeKey)` (the node's params with default-preset params laid over), now shared with conformance C39.
  Keep it to the length of the neighbouring sections' bullets.

## Files owned (edit only these)

`contracts/src/outlets.ts`, `sdk/src/variables.ts` (the one description), `core-catalog/src/registry/entries.ts` (the history JSDoc), `guides/writing-lore-from-a-pipeline.md`, `guides/genres-presets-and-routines.md`, `INTEGRATING.md` — all under `/home/jody/github/serene-pub-sdk/`.

## Files readable

Anything in both repos. Read large files by line range (`sed -n`), never whole. INTEGRATING.md by section (grep `^## `).

## Out of scope (never build)

- `cli/src/compiler.ts`, `sdk/src/document.ts`, `conformance/`, `sdk-tests/` (worker w2's).
- Any app (`serene-pub`) file, `NOMENCLATURE.md`, the app's `docs/`.
- New query nodes, new names beyond `note-scene@1` / `noteScene` / the label "Note it in the scene", any change to the history entry type's `i18n` text, any other copy change.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a name not in this brief seems needed; a fact this brief states does not match the code (say which, with file:line); the note-scene declaration does not type-check as given.

## Done means

- Edits above made.
- Run, from `/home/jody/github/serene-pub-sdk/sdk-tests`, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test castMember.test.ts forms.test.ts contract.test.ts guides.test.ts guideSnippets.test.ts loreBuilders.test.ts > /tmp/claude-1000/hist-C-w1-tests.log 2>&1; echo test-exit=$?'` then read the log's summary lines with `grep -n "^# \|not ok" /tmp/claude-1000/hist-C-w1-tests.log` (never pipe test output into `head`). If `/tmp/claude-1000` does not exist use the scratchpad you are given.
- `npx prettier --check` already fails on these files before your edit; do not run prettier. Match the surrounding style by hand.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build` at all; the supervisor does.)
- Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write`.
- Scratch files start with `hist-C-`.

## Report

Changed files with a one-line summary each; the test command and its pass/fail counts (name every failing test and whether it is yours); anything unverified in the recipe; facts that did not match this brief; Noticed, not done.
