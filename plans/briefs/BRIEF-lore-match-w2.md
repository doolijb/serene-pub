# BRIEF — lane `lore-match`, worker 2 — app: the read, and the create write that updates what it was shown

You are a `lane-worker`. Your supervisor owns lane `lore-match`; this brief is your whole contract. App repo
`/home/jody/github/serene-pub`. Use absolute paths.

## Verbatim rules (from the lane guide; they bind you)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — **you do not run `sdk:build`**; the supervisor runs it once, last.
- Never `git checkout` / `restore` / `stash` in either repo. Never `prettier --write` on a directory. Never `kill -9`.
  Do not start a dev server.
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- No migration, no data pass, no new table, column, setting or event.
- No reference to any other project or product in code, comments, tests or docs.
- Comments state the rule, not the story: `src/lib/shared/conformance/commentHistory.test.ts` fails on phrases such
  as "no longer", "used to", "deliberately not" in comments.
- It is a **session**, never a *chat* (Chat is only a genre's name). Every session has a lorebook.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything**; line numbers are from 2026-11-13 and may have moved.
- Tests run only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > /home/jody/github/serene-pub/plans/lore-match-w2-<n>.log 2>&1"`
  from the app root — targeted files only, never two runs at once, never piped into `head`. An int test that opens a
  DB inside an `it` needs a 60 s timeout.
- Do not re-pin hash tests. If a pin moves, list the test, the pin and its new value.
- ANOTHER SESSION edits this checkout. Do not edit: `src/lib/server/pipelines/runtime/liveRow.ts`,
  `src/lib/server/messages/store.ts`, `src/lib/server/sockets/utils/broadcastHelpers.ts`, `src/lib/server/plugins/**`,
  `src/lib/server/pipelines/scripts/**`, `src/lib/server/scripts/**`, `src/lib/server/utils/llmQueue.ts`,
  `src/lib/server/pipelines/boot/registrySync.ts`, `src/lib/server/pipelines/ranking/**` (call, never edit),
  `src/lib/server/sockets/entries.ts`, `src/lib/server/sockets/lorebooks.ts`, `src/lib/client/**`. Failures in or
  caused by those files are not yours: list them.

## Files owned (edit only these)

- `src/lib/server/pipelines/runtime/host.ts` — **only** the `case "core:outlet/create-lore-entry":` block
  (~11469–11823). Do not change `changeLoreEntry`, `holdLoreEntryChange`, `fileOntoHistoryDay`, `sessionLoreWriteTo`
  or any other host code. Helpers you need go in `loreMatch.ts`.
- `src/lib/server/pipelines/runtime/loreMatch.ts`.
- `src/lib/server/pipelines/runtime/bindings.ts` — one new query binding only.
- Tests: new files, and the existing suites named under **Tests** where the rule changed what they pin.

## The SDK half (worker 1, in parallel; built by the supervisor at the end)

- New query `core:query/entries-named@1` (contract export `entriesNamed`): in `scope` (session scope), `messages`
  (session rows, `core:query/session-history@1`'s `messages`), `budget` (`core:task/context-budget@1`'s
  `available`, optional); params `entryTypes` (list of entry type ids; empty = `core:entry/world-lore`),
  `maxEntries` (default 12, 0 = none), `share` (default 0.2); out `main` = `Array<{ entryId, entryType, name,
  content, byPerson }>`, `ids` = the `entryId`s of `main` in order.
- New optional in-port `shown` on `core:outlet/create-lore-entry@1`: the ids of the entries the writing model was
  shown.
- The dist is not rebuilt until the end, so `C.entriesNamed` and `p.shown` do not typecheck yet. Write the binding
  as the others are (`reads<typeof C.entriesNamed>(…)`) and read the port as `(p as { shown?: unknown }).shown`
  (the way the case reads `toNotes`); the supervisor typechecks after the build. Your host-level tests must not need
  the rebuilt SDK.

## Read first

- `plans/briefs/BRIEF-lore-match.md` (the lane brief; its five-sentence rule and **Build** items 1–3 are yours).
- `src/lib/server/pipelines/runtime/loreMatch.ts` (whole), `src/lib/shared/lorebooks/describingRow.ts` ~1–80
  (`keyTerms`, `answeringRows`, the three tiers: name exact, name by `sameName`, a key term).
- `host.ts`: `holdLoreEntryChange` ~2189–2243 (how it reads "what the session reads": `sessionReadingOf` +
  `entryOverlaysFor` + `entryAt(toEntryRow(stored), …)`), `changeLoreEntry` ~2255–2348 (name/content/patch; own book
  in place, lorebook entry held; in place it writes `content` even when equal — so check equality yourself first),
  `fileOntoHistoryDay` ~2359–2470 (passes `name: undefined` so the day keeps its name; its paragraph join is
  `` `${held.trimEnd()}\n\n${a.content}` ``), `sessionLoreWriteTo` ~1634–1715, the create case ~11469–11823, the
  host's `lorebook_entries` read ~4582–5330 (books via `lorebooksReadBy`, each at
  `bookId === readingOrNone?.lorebookId ? sessionReading : MAIN_HEAD`; own-book rows marked `sessionOnly`).
- `state/entriesOnReading.ts` `entriesAsRead` ~196–270 (`unseen`), `lorebooks/ownBook.ts` `lorebooksReadBy`.
- SDK `sdk/src/names.ts` (`namesName`, `sameName`; exported from `@serene-pub/sdk`).
- `bindings.ts` `"core:query/earlier-scenes@1"` ~8675–8700 (a query reading `db` directly with a `budget` port and a
  `share` param) and `"core:task/context-budget@1"` ~5221 (`ctx.countTokens`).
- The suites under **Tests**, before changing them.

## Build

### A. The read — `entriesNamedIn` in `loreMatch.ts`, bound as `core:query/entries-named@1` in `bindings.ts`

`export async function entriesNamedIn(db, sessionId, { typeIds, messages, maxEntries, maxTokens, countTokens })`:

- Books: `lorebooksReadBy(db, { id: sessionId, lorebookId: session.lorebookId })`, **own book first, then the
  attached lorebook** (the order `findLoreMatch` looks in). Each read at the reading the session reads it with —
  the host's listing rule (`bookId === readingOrNone?.lorebookId ? sessionReading : MAIN_HEAD`, with
  `sessionReadingOf(db, sessionId)`), so a held change of this session is part of what it reads.
- Entries: `entriesAsRead(db, bookId, reading, "session", typeIds)`, keep `!unseen`; for each kept one, its whole
  `content` as read (`entryOverlaysFor` + `entryAt(toEntryRow(stored), overlays, reading)`, as
  `holdLoreEntryChange` reads it — batch the stored rows, don't query per entry) and `byPerson =
  stored.provenance === "human"`. Switched-off and archived rows are not shown (check `entriesAsRead`'s `unseen`
  covers them; if not, filter on the stored columns).
- Named: an entry is named when `namesName(row.content, entry.name)` or `namesName(row.content, k)` for any of
  `keyTerms(entry.keys)` holds for **one** message row (rows flattened one level, `isHidden` and non-numeric/negative
  ids skipped, as `undescribedName.ts rowsOf` does — copy nothing from `ranking/`). Skip a key term of an entry whose
  keys are regular expressions (`useRegex`) — say so in a comment.
- Order: own book's entries then the lorebook's, each in entry order. Cap: at most `maxEntries` (0 → `[]`); with
  `maxTokens` a number, each entry costs `countTokens(name + "\n" + content)` (fallback `Math.ceil(chars / 4)`), and
  an entry costing more than what is left is skipped while later ones are still tried.
- Returns rows `{ entryId, entryType, name, content, byPerson }`.

Binding (thin): session from `input.scope.sessionId` (halt with a sentence when absent, as `earlier-scenes` does);
`typeIds` from `params.entryTypes` (non-empty strings; empty → `["core:entry/world-lore"]`, i.e.
`WORLD_LORE_TYPE_ID`), `maxEntries` from params (absent → 12, clamped ≥ 0), `share` (absent/invalid → 0.2, in
[0,1]), `maxTokens = floor(share × budget.total)` when `input.budget.total` is a positive number, else none.
`ok({ main: rows, ids: rows.map(r => r.entryId) })`. `{ ports: ["scope", "messages", "budget"], params:
["entryTypes", "maxEntries", "share"] }`. Read `db` as `earlier-scenes` does.

### B. The create write with `shown` (host.ts create case; helpers in loreMatch.ts)

For a write whose `match` is `{ name }` **and** that carries `shown` (a list; non-integer members ignored):

1. Look the name up within the write's entry type: **by name first across the books** (own book, then the
   attached lorebook; tiers 1–2 of `answeringRows`, i.e. rows offered without their keys), and only when no book
   has a name hit, **by key term** (tier 3). Add an exported helper in `loreMatch.ts` (e.g.
   `lookLoreMatch(tx, at, name, then?) → { by: "none" } | { by: "name", ids: [{id,name}], lorebookId } | { by:
   "key", ids: [{id,name}] }`) over the same rows `findLoreMatch` reads (`entriesAsRead(…, "session", [typeId])`,
   `!unseen`). Do not change `findLoreMatch`'s behaviour: a write without `shown` (a plugin's pipeline, the tool
   loop, `{ entryId }` and `{ key }` matches) goes exactly as today, refusal sentence included.
2. Then, inside the existing transaction, under the book's lock:
   - **two or more by name** (within one book): no write, no fork, nothing recorded; the result is
     `{ lorebookId, route, written: false, notes: [<sentence>] }` (no `id`, no `matched`; keep `...noted` from
     `checked`/day notes). 🚧 sentence: `` `${n} entries answer to '${name}' — ${list}; nothing was written for it.` ``
     with `list` as today's refusal spells candidates (`'Mira' (entry 4), 'Mira' (entry 9)`). The run goes on.
   - **one by name, its id in `shown`** → **rewrite**: content as the session reads it (as `holdLoreEntryChange`
     reads it; for the attached lorebook's entry use `target.line.alsoReads.reading` when the entry is that book's,
     else `target.line.reading` — confirm these readings carry the session's held changes) compared with the
     write's `content` (trimmed both): equal → nothing changes (`changed = false`); else `changeLoreEntry({ …,
     stored, patch: fields, name: undefined, content: p.content, anchor }, tx)` — **no name**, so the entry keeps
     its own.
   - **one by name, not in `shown`** → **append**: the content as the session reads it; when the write's text
     (trimmed) is empty, equals that content, or equals one of its paragraphs (split as `passageNaming` splits:
     `/\n[^\S\n]*\n/u`), nothing changes; else `changeLoreEntry` with `content = read.trimEnd() + "\n\n" + text`
     (just `text` when read is empty) and `name: undefined`. Appending onto what the session reads keeps an
     earlier held change to that entry (do not append onto the stored row).
   - **key only** (no name hit; one or more key hits) → not a match: written as a new entry exactly as a write with
     no hit is (fork, insert, imprint, links, Exits line), plus a note. 🚧 `` `'${name}' met a key of ${list}; written as a new entry.` ``
   - **none** → create, as today.
   - A rewrite or append returns exactly today's matched result (`matched: true, written: false`, `heldIn`
     routing, `record(node, "lore_entry", id, "updated")` only when `changed`). 🚧 add a note for an append:
     `` `added to '${entryName}' (entry ${id}) as a new paragraph.` `` and for an unchanged one
     `` `'${entryName}' (entry ${id}) already says this; nothing was written.` ``
3. Notes ride the result's `notes` exactly as `dayNote` does today (find how they reach the run's receipt and
   confirm in a test that they do).
4. Nothing else in the case changes: history writes, `entryId`/`key` matches, `match` without `shown`, writes with
   no match, `links`, `bind`, `sources`/settle.

### C. Tests

New `src/lib/server/pipelines/runtime/host.loreMatchShown.int.test.ts` (and `loreMatch.entriesNamed.int.test.ts`
for A), with real PGlite as the neighbouring suites do (copy their setup helpers; 60 s timeouts):

- **A**: named by name and by key, in one message (a name split across two messages does not count); own book
  first, then the lorebook; only `typeIds`; switched-off/archived/unseen left out; a held change's content is what
  is returned; `byPerson`; `maxEntries` cap; the token cap skips a too-long entry and keeps a later short one;
  `maxEntries: 0` → empty; `ids` order.
- **B**: shown + name hit on an **own-book** entry → content replaced in place, name kept (even when the write's
  name differs in case/article), `matched: true, written: false`, no `lore-entry-created` (assert the result's
  `written === false`; if the suite can run the SDK executor over the case, assert the receipt's `emitted` is
  empty); shown + name hit on a **lorebook** entry → a held amendment (`base` set), the lorebook row untouched, name
  kept; unshown name hit → a paragraph onto what the session reads, an earlier held change to it kept; key-only →
  a new entry and the note; identical text → nothing written, no amendment, no imprint; two name hits → no write,
  the note, a result with `written: false`, and the run is not failed (the case returns rather than throws); a new
  name → creates; a write **without** `shown` behaves as before (two hits still refuse with today's sentence;
  `{ key }` still updates); Back, a swipe and a regenerate take a rewrite/append with its turn (use the retraction
  helpers `host.heldEntryChange.int` / `state/heldAmendments.undo.int` use; one of the three is enough per route if
  they share the path — say which).
- The pinned suites must still pass, updated only where the rule changed what they pin and never weakened:
  `runtime/loreSources.int` (g), `runtime/host.ownBookRoute.int`, `runtime/host.heldEntryChange.int`,
  `state/heldAmendments.readers.int`. Run them, plus `src/lib/shared/conformance/commentHistory.test.ts`.

Do **not** write the end-to-end sweep / Remember things tests (they need the rebuilt SDK); the supervisor gives them
to a later worker. But read `src/lib/server/sockets/sessions.taskSweep.int.test.ts` and `sessions.chatMemory.int.test.ts`
and say in your report how a test there can (a) make the fake model return a chosen `lore`/`notes` answer and (b)
read the prompt the model was sent.

`npx prettier --check <file>` on each changed file. Do not run `tsc` over the whole app (the SDK dist is stale);
the supervisor does after the build.

## Stop and ask (report instead of improvising) when

The rule needs a change outside the create case of `host.ts` (in `changeLoreEntry`, `holdLoreEntryChange`,
`sessionLoreWriteTo`, the review gate, `ranking/`); a migration, setting, event or result value other than the
`notes` sentences above would be needed; the readings in B.2 do not carry the session's held changes.

## Report

Write your report to `/home/jody/github/serene-pub/plans/REPORT-lore-match-w2-2026-11-13.md`: changed files; the
rule as built per case; the exact note sentences; tests run (file, pass/fail counts, log path); pins moved; the
answer on the two e2e suites; decisions inside scope; **Noticed, not done**.
