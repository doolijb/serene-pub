# REPORT — lore-match worker 2 (2026-11-13)

Status question: none relayed.

## Changed files
- `src/lib/server/pipelines/runtime/loreMatch.ts` — added `entriesNamedIn`, `lookLoreMatch`, `matchNameOf`, `shownIdsOf`, `contentAsRead`, `appendedContent` (and `LoreLook`, `NamedEntry` types). `findLoreMatch` is unchanged.
- `src/lib/server/pipelines/runtime/bindings.ts` — new binding `core:query/entries-named@1` (ports `scope, messages, budget`; params `entryTypes, maxEntries, share`). **One more edit, beyond "one new binding":** `"shown"` added to the `ports` list of `core:outlet/create-lore-entry@1`. `declaredReads` fails on a declared in-port no handler lists, so this one word is needed once the SDK is built. Please confirm it is within the lane.
- `src/lib/server/pipelines/runtime/host.ts` — only the `core:outlet/create-lore-entry` case. The `loreMatch` module is imported dynamically inside the case, so the file's import block is untouched.
- New tests: `src/lib/server/pipelines/runtime/host.loreMatchShown.int.test.ts`, `src/lib/server/pipelines/runtime/loreMatch.entriesNamed.int.test.ts`.

## The rule as built
**Read (`entriesNamedIn`).**
- Books are own book first, then the attached lorebook. Each book is read at the host's listing rule: `bookId === sessionReadingOf().lorebookId` gets the session reading (held changes included), otherwise `MAIN_HEAD`.
- Entries come from `entriesAsRead(.., "session", typeIds)`, keeping `!unseen`. That already covers switched-off and archived rows, and amendment-driven off/archived at the reading.
- Content is read with `entryOverlaysFor` + `entryAt(toEntryRow(stored))`, batched per book. `byPerson = provenance === "human"`.
- An entry is named when `namesName(row, name)` or `namesName(row, key)` holds for one message row. Rows are flattened one level, with `isHidden`, negative and non-numeric ids skipped. Key terms are skipped for a regex-keyed entry (`matchMode === "regex"`, or null `matchMode` with `useRegex`); only its name is looked for.
- Order is own book, then lorebook, each in entry order. `maxEntries <= 0` returns `[]`. With `maxTokens`, an entry costs `countTokens(name\ncontent)` (fallback chars/4). One that does not fit is skipped and later ones are still tried.
- The binding defaults are `entryTypes` empty → world lore, `maxEntries` 12, `share` 0.2. `maxTokens = floor(share × budget.total)` when `total` is positive, else none. `ctx.countTokens` is used when the handler is given one. `ids` = the entry ids of `main`.

**Write.** The rule applies only when the write has `shown` as a list, has `match` of the form `{ name }` (no `entryId`, no `key`) and is not a history write. Otherwise `findLoreMatch` runs exactly as today, refusal sentence included. A non-list `shown` counts as absent. An empty list `[]` does engage the rule.
- Lookup is by name first across the books (own, then lorebook), through `answeringRows` tiers 1–2 over rows offered without keys. Only when no book has a name hit does it look by key, through tier 3, over rows offered without names. This runs under the book's lock, before any fork.
- **Two or more by name:** no write, no fork, no record, no settle. The result is `{ lorebookId, route, written: false, notes: [...checked notes, sentence] }`. The case returns, it does not throw.
- **One by name, id in `shown`:** rewrite. The entry's content as the session reads it is compared (trimmed) with the write's content. Equal, or empty write text, leaves it unchanged. Otherwise `changeLoreEntry({ …, name: undefined, content })`, so the entry keeps its name. The attached lorebook's entry is held; an own-book entry is written in place.
- **One by name, not in `shown`:** append. `appendedContent(read, text)` returns null when the text is empty, equal to the content, or one of its paragraphs. Otherwise the text goes after `read.trimEnd()` + blank line, onto what the session reads. `changeLoreEntry` runs with `name: undefined`.
- **Key only:** a new entry, exactly as no hit (fork, insert, imprint, links, Exits line), plus a note.
- **None:** create, as today.
- A rewrite or append returns today's matched result. `record(… "updated")` happens only when `changed`.
- Readings used: an entry of the write's own target book reads at `target.line.reading`, otherwise at `target.line.alsoReads.reading`. Both carry `holderBookId`, so a held change of this session is part of what is compared and appended onto. This is tested: an append onto an earlier held rewrite keeps it.

## Exact note sentences (🚧)
- Tie: `` `${n} entries answer to '${name}' — 'X' (entry 4), 'X' (entry 9); nothing was written for it.` `` The name is as the model wrote it, trimmed.
- Key only: `` `'${name}' met a key of 'Mira' (entry N); written as a new entry.` ``
- Append: `` `added to '${entryName}' (entry ${id}) as a new paragraph.` ``
- Unchanged (rewrite or append): `` `'${entryName}' (entry ${id}) already says this; nothing was written.` ``
- A successful rewrite has no note.
- Notes ride `result.notes` like `dayNote`. A test runs the binding with a stub `ctx.commit` and sees `{ kind: "ok", value: { written: false, notes } }`. A full receipt check needs the rebuilt SDK, and the executor was not run.

## Tests
Logs are in `/home/jody/github/serene-pub/plans/`.
- `loreMatch.entriesNamed.int.test.ts` + `host.loreMatchShown.int.test.ts` (`lore-match-w2-3.log`): 2 files, 16 tests, all pass. They cover:
  - Read: name and key within one message, a name split across two messages, own-first ordering and `ids`, entry types, off/archived, held content, `byPerson`, count cap, token cap that skips a long entry and keeps later ones, `maxEntries: 0`, hidden and unstored rows.
  - Write: own-book rewrite (name and article differing, `written: false`, no new row), own-book append and unchanged, lorebook rewrite held with `base` set, lorebook row untouched and name kept, unshown append onto an earlier held change, identical text with no amendment or imprint, key-only note, two-hit tie, new name creates, no-`shown` behaviour (two hits still refuse with today's sentence, `{ key }` still holds an update).
  - Retraction: one swipe test (`retractStateAnchoredTo`) takes back both a held rewrite and an own-book in-place rewrite with their turn. Back, regenerate and delete share that path (`heldAmendments.undo.int`), so I did not repeat them.
- `loreSources.int`, `host.ownBookRoute.int`, `host.heldEntryChange.int`, `heldAmendments.readers.int` (`lore-match-w2-4.log`): all pass, unchanged.
- `src/lib/shared/conformance/commentHistory.test.ts`: **1 failed**. It lists 9 files (e.g. `localOnnxModels.ts`, `activityStore.ts`, `androidWrapper.ts`). None is mine; my files do not appear in the findings. This is not caused by my files.
- Prettier: `host.ts`, `bindings.ts` and `loreMatch.ts` are all unformatted at HEAD as well (checked via `git show HEAD:… | prettier --stdin-filepath`), so `--check` cannot pass; I did not reformat them. I did not run `prettier --check` on the two new test files.
- No `tsc` run, as briefed. `C.entriesNamed` and the `shown` port will not typecheck until the SDK is built.

## Pins moved
None.

## E2E suites (read only)
- **(a) A chosen answer:** both suites mock `getConnectionAdapter` with a `FakeAdapter` whose `generateText()` returns text chosen by substring of `JSON.stringify(this.injected)`, the injected compiled prompt.
  - `sessions.taskSweep.int.test.ts` returns `script.sweep` when the prompt contains "You keep the books of a story". `script.sweep` is a hoisted mutable the test sets, so it can hold any `lore`/`notes` JSON.
  - `sessions.chatMemory.int.test.ts` returns `JSON.stringify({ notes: [{ name, content }] })` when the prompt contains "You keep an assistant's notes".
  - To drive the new sweep or Remember path, add a branch (or a mutable `script`) keyed on that pipeline's prompt text, returning the chosen JSON.
- **(b) Reading the prompt sent:** `withCompiledPrompt(p)` stores `p` in `this.injected`. chatMemory also pushes `JSON.stringify(p)` into a module-level `prompts[]`, so a test can assert `prompts.some(p => p.includes("<entry text>"))`. taskSweep keeps only `injected` per instance, so a `prompts[]` push must be added there.

## Decisions inside scope
- A rewrite whose text is empty is treated as "nothing changes", so an empty write cannot blank an entry.
- On an unchanged rewrite the `fields` patch is not applied, which follows the brief ("equal → nothing changes").
- Key-only hits are taken from the first book that has key hits, like `answeringRows`' list-order rule.
- `lookLoreMatch` offers rows without keys (name tiers) and without names (key tier) to the one shared `answeringRows`, so the rule is not copied.

## Noticed, not done
- The `declaredReads` and `bindingCompat` boot checks will fail until the SDK dist is rebuilt with worker 1's `shown` port. The `shown` addition to the `ports` list is already in.
- Prettier does not pass on any of the three runtime files at HEAD.
- The `commentHistory` test currently fails on 9 files owned by other lanes.
