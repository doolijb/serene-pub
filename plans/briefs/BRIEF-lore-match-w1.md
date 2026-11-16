# BRIEF — lane `lore-match`, worker 1 — SDK: the query contract, the `shown` in-port, the sweep's and Remember things' wiring

You are a `lane-worker`. Your supervisor owns lane `lore-match`; this brief is your whole contract. Repo:
SDK `/home/jody/github/serene-pub-sdk` (app repo `/home/jody/github/serene-pub` only to read). Use absolute paths.

## Verbatim rules (from the lane guide; they bind you)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — **you do not run `sdk:build` at all**; the supervisor runs it once, last.
- Never `git checkout` / `restore` / `stash` in either repo (most of the SDK is uncommitted). Never `prettier --write` on a directory. Never `kill -9`.
- No reference to any other project or product in code, comments, tests or docs.
- Comments state the rule, not the story: no "no longer", "used to", "deliberately not", "was …" histories in new comments.
- It is a **session**, never a *chat* (Chat is only a genre's name). Every session has a lorebook.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Another session is editing this checkout. Stay off `core-catalog/components/shared/messages/**` and `core-catalog/src/shared/ui/conversation/**`.
- Do not re-pin hash tests. If a pin moves, list the test, the pin and its new value.

## Files owned (edit only these)

- `contracts/src/outlets.ts`: the `create-lore-entry@1` in-ports and JSDoc, and the `LoreMatch` JSDoc only.
- `contracts/src/queries.ts`: the one new query below, and whatever list in `contracts/src/**` registers a query
  definition (find how `earlierScenes` is registered/exported and do the same; if that list is in another file of
  `contracts/src`, you may add the one line there).
- `core-catalog/src/shared/lore.ts`, `core-catalog/src/genres/story/sweep.ts`, `core-catalog/src/genres/story/reckon.ts`
  (only `entryWrites`, `sweepBranch`, and a new export if needed), `core-catalog/src/genres/chat/memory.ts`,
  `core-catalog/src/seed/scripts.ts` (or wherever `CORE_SCRIPTS` lists seeded scripts) to add the one new script.
- New or existing tests in `sdk-tests/*.test.ts` for what you touch.

Do **not** edit: `core-catalog/src/seed/prompts.ts` (no prompt row changes), `STORY_SWEEP_CRIB_SCRIPT` /
`STORY_SWEEP_SCRIPT` sources (their app test lives in a file another session owns), the `scenes` arm's behaviour.

## Read first

- `contracts/src/outlets.ts` ~1740–1890 (create-lore-entry@1) and ~2095–2115 (`LoreMatch`).
- `contracts/src/queries.ts` ~1365–1416 (`earlierScenes`: the template for a query with a `budget` in-port and a
  `share` param) and the `lorebookEntries` `entryTypes` param (~3760).
- `core-catalog/src/shared/lore.ts` (whole, 123 lines), `genres/story/sweep.ts`, `genres/story/reckon.ts` ~380–470,
  `genres/chat/memory.ts`, `shared/calls.ts` ~150–330 (`textPart`, `scriptStep`, `modelCall`), `shared/scriptSeed.ts`.
- How a spec wires `C.contextBudget.v1({ sampling: slot.samplingOf('…'), connection: slot.connectionOf('…') })`
  (`genres/lair/buildRoom.ts` ~117, `genres/story/narrate.ts` ~294) and passes `budget: $.contextBudget.available`.

## The rule being built (owner rulings 2026-11-12/13: "Let the model rewrite it"; updates only, no children)

When Story's sweep (its `lore` and `cast` duties) or Chat's *Remember things* is about to write lore, the step first
reads the entries the session already has **whose name or key appears in the lines the step read**; the prompt shows
the model each one's name and whole text and says: return an entry only when something about it changed, under the
same name, with its **whole** updated text; return a new name only for something that has no entry. Each item is
then written with `match: { name }` and the ids it was shown (`shown`). What the host does with them is worker 2's.
The sweep's `scenes` duty (places) is **not** touched. Nothing is added to the prompt when the list is empty: the
prompt is then byte-identical to today's.

## Build

### 1. The new query — `core:query/entries-named@1` (🚧 every name provisional), export `entriesNamed`

In `contracts/src/queries.ts`, beside `earlierScenes`, `describeQueryDefinition` + `pin`, `@experimental`:

- `i18n: { name: { en: 'Entries the lines name' } }`, `timeoutMs: 2000`.
- params (`kind: 'parameters'`), each with `label` and a one-sentence `description` (P4/P5: purpose):
  - `entryTypes`: `{ type: 'list', item: { type: 'text' } }`, label `Entry types looked for`, description
    `Which kinds of entry to look for, by type id. Leave it empty for world lore.` (empty = world lore only).
  - `maxEntries`: integer, `default: 12`, `min: 0`, label `Entries shown at most`, description
    `How many existing entries the model is shown before it writes. 0 shows none.`
  - `share`: number, `min: 0`, `max: 1`, `default: 0.2`, label `Share — entries shown`, description
    `How much of the context window the entries shown may take. An entry too long to show whole is left out.`
- ports: `in: { scope: S.sessionScope, messages: S.messages, budget: S.budget }`, `out: { main: S.json, ids: S.json }`.
- JSDoc (state the rule, not the story): `main` is `Array<{ entryId: number, entryType: string, name: string,
  content: string, byPerson: boolean }>` — the entries of `entryTypes` the session reads (its own book first, then
  the attached lorebook, each as the session reads it, held changes included; switched-off, archived and unseen
  entries left out), whose name or one of whose keys appears as whole words in one of `messages` (the SDK's
  `namesName`), in that order, at most `maxEntries`, and within `floor(share × budget.total)` tokens when `budget`
  is wired (an entry too long for what is left is left out, the next one still tried). `content` is the whole text
  as the session reads it. `byPerson` is true for an entry a person wrote (`provenance: "human"`). `ids` is the
  `entryId` of each row of `main`, in order: what a write passes as `create-lore-entry@1`'s `shown`. Deterministic,
  no model. ⚠ Not `core:query/entity-search@1` (ranked retrieval by annotated entities over its own window), not
  `core:query/lorebook-entries@1` (the listing). **A query writes nothing.**

### 2. The `shown` in-port on `create-lore-entry@1` (🚧, additive, optional)

`shown: S.json` after `match`, with JSDoc: 🚧 The entries the model that wrote this was shown, by id
(`core:query/entries-named@1`'s `ids`). Read only with `match: { name }`: one entry it was shown, found by its
name, is rewritten — its content replaced by this write's, its own name kept; one entry of that name it was not
shown keeps what it says and gets this write's content as a new paragraph; an entry met only by one of its keys is
not a match — a new entry is written and the result notes the entry whose key it met; two or more entries of that
name change nothing for this write (`written: false`) and the result notes them; content equal to what the entry
says changes nothing. A change to an existing entry goes where such changes go (a held change for a lorebook
entry, in place for an own-book one), and the result is `matched: true, written: false`, so no
`core:event/lore-entry-created@1`. Absent: `match` behaves as described on `LoreMatch`.

Add one paragraph to the `LoreMatch` JSDoc pointing at `shown` for the rewrite/append rule, and a short `##` section
to the create-lore-entry JSDoc ("## Updating what exists") saying the same in two sentences. Do not change any other
port, result value or the event.

### 3. `fileLore` (`core-catalog/src/shared/lore.ts`)

Add an optional `shown?: ReadOn<B>` to `fileLore`'s opts (JSDoc: 🚧 the ids of the entries the model was shown,
read with `matchByName`), passed to the outlet as `shown: (opts.shown as any)($)` when given. `rememberNote`
unchanged.

### 4. One seeded script: `core:script/entries-named-brief` (🚧), "Show the model what is already kept"

A `seedScript` (data transform), listed in `CORE_SCRIPTS` (find where). Handed `{ brief, entries, modes, duties }`:
`brief` text; `entries` the query's `main`; `modes` a duty→mode map as the sweep's `$.duties.modes` (optional);
`duties` a list of duty keys (optional). Returns `{ brief }` (or the shape that reads cleanest into a `textPart`):

- when `entries` is empty or not a list, or `duties` is given and every one of them is `off` in `modes` (use the
  preamble's `modeOf` if the script runs with it; otherwise read `modes[duty]`, absent = on): `brief` unchanged,
  **byte for byte**;
- otherwise `brief + "\n\n" + block`, the block exactly (🚧 provisional copy, verbatim):

```
Some of what these lines name already has an entry, listed below. Return one of those only when something about it changed, under the same name and with its whole updated text: everything it still says, with the change. Return a new name only for something that has no entry yet.

Already kept:
- {"name":"<name>","content":"<content>"}
- {"name":"<name>","content":"<content>"} (written by a person: keep its facts and wording unless these lines changed them)
```

one `- ` line per entry in the order given, `JSON.stringify({ name, content })` for the object, the parenthesis only
for `byPerson: true`. No trailing newline.

### 5. Wiring the sweep (`reckon.ts` `sweepBranch`, `entryWrites`)

- In `sweepBranch`, beside the `state` query: a `contextBudget` task on the sweep's write
  (`sampling`/`connection` of `sweepWrite`, as other specs do for their write; find the right relative key inside
  the `sweep.due` branch) and a query `named` = `C.entriesNamed.v1({ scope: $.input.sessionScope, messages:
  $.history.messages, budget: <that budget>.available, params: slot.params() })` with
  `w.params.push([on(…,'named'), { entryTypes: ['core:entry/world-lore', 'core:entry/character-lore'] }])` (use
  `bareEntryTypeId(worldLoreEntryType)` / `characterLoreEntryType`, as `fileLore` does). Expose label
  `What is already kept`, status `Looking back over the story`.
- After the `brief` textPart: a script step running the new script with `{ brief: $.brief.text, entries:
  $.named.main, modes: $.duties.modes, duties: ['lore', 'cast'] }`, then whatever text step makes it text; the
  `modelCall`'s `brief` reads that instead of `$.brief.text`.
- `entryWrites` gets an optional flag (e.g. `known?: true`): when set, `fileLore` is called with
  `matchByName: true, shown: ($) => $.sweep.due.named.ids`. Pass it for `lore` and `cast`; **not** for `scenes`.

### 6. Wiring *Remember things* (`memory.ts`)

Inside the `memory.due` branch, before `modelCall`: the same `contextBudget` task on `memoryWrite`, a `named` query
(`entryTypes: ['core:entry/world-lore']`), and a script step with `{ brief: MEMORY_BRIEF (as a literal the step can
read — e.g. a `textPart`/constant node, or the script given the brief text by a param), entries: $.named.main }`
(no `duties`); `modelCall`'s `brief` reads its result. `fileLore` gets `matchByName: true, shown: ($) =>
$.memory.due.named.ids`. If handing a constant to a script step needs a pattern, follow how the codebase hands a
literal to a step (params via `w.params.push`); pick the plainest and say which in your report.

### 7. Tests (sdk-tests)

Add `sdk-tests/entriesNamedBrief.test.ts` (or extend `loreBuilders.test.ts`) covering: the script with an empty list
returns the brief byte-identical; with entries it renders the block exactly (one person-written entry carries the
parenthesis, one does not); `duties` all off → unchanged; the compiled sweep spec's `lore` and `cast` writes carry
`match` and `shown`, the `scenes` write carries neither; Remember things' write carries both; the `named` query is
wired with the entry types above. Find how existing tests run a seeded script's source (search sdk-tests for
`STORY_SWEEP_CRIB_SCRIPT` or `runScript`/`seedScript` usage) and do the same; if none runs scripts, test the source
with the plainest evaluator the suite already uses, and say so.

Run only targeted SDK tests, from `/home/jody/github/serene-pub-sdk/sdk-tests`: `npx tsc --noEmit -p .` is the
suite's typecheck — run it once (it covers every file; capped:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit > /home/jody/github/serene-pub/plans/lore-match-w1-tsc.log 2>&1"`),
then `npx tsx --test <file>` for each test file you touched plus `loreBuilders.test.ts`, `coreCatalog.test.ts`,
`coreGenreDefaults.test.ts`, `writesHistory.test.ts`, `loreLinks.test.ts`, `catalogueVocabulary.test.ts`,
`deriveDontSpell.test.ts` (known failing before you: `deriveDontSpell`; say whether your change adds failures).
Same capped scope for each run. `npx prettier --check <file>` on each changed file.

## Stop and ask (report instead of improvising) when

A published SDK name, port, result value or event other than the new query and `shown` would change; the contract
cannot be expressed as above; the brief's step cannot be wired without changing a prompt row or the sweep's crib
script; `S.budget` / `S.messages` do not exist under those names (say what does).

## Report

Write your report to `/home/jody/github/serene-pub/plans/REPORT-lore-match-w1-2026-11-13.md`: changed files; the
exact ids, names, labels, param defaults and row shape as built; how the brief text reaches `modelCall`; tests run
and results (with known failures named); any pin or hash that moved (test, pin, new value); decisions inside scope;
**Noticed, not done**.
