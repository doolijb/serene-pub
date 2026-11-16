# BRIEF — lane `perf-G`, worker 2 — keyword retrieval builds its gazetteer and pool term profile once per pool

Repository root: `/home/jody/github/serene-pub`. Use absolute paths. Line numbers are from 2026-11-13; re-read before editing.

## Goal

`keywordQuery` (`src/lib/server/pipelines/ranking/keywordQuery.ts:324`) runs once per retrieval lane per turn. Every
call rebuilds two things that depend only on the entry pool and the cast, never on the conversation:

1. **The gazetteer** — `buildGazetteer([...entityRefs, ...entries' {name, ref:{kind:"entry", id}}])` at
   `keywordQuery.ts:512–526`; inside it, `normalise` + `distinctiveTokens` per name and `compileMatcher`'s big
   alternation `RegExp` (`entities.ts:547–563`, `:698–719`).
2. **The pool's term document frequency** — in `buildEvidenceProfile` (`entities.ts:1173–1249`), `termsOf(text)` (a
   `tokenize`) for every entry text and the `termDf` → `termRarity` maps (`:1213–1236`). Input: `entryTexts` only
   (`entries.map(entryText)`, `keywordQuery.ts:281`).

Cache those two, keyed on their exact inputs. Everything else stays computed per call, exactly as now — this is ruling
[C3]: *"Only the expensive, input-independent parts are cached: the gazetteer regex and the DF profile… The scan itself
(which takes the node's own `params.retrieval`, `currentCharacterId`, `currentCastMemberId`) is not memoised, so no two
nodes can share a wrong answer."*

⚠ **What is NOT input-independent, and stays uncached:** `extractEntities(window, gazetteer)`, the window-entity
`matcher` built inside `buildEvidenceProfile` (`:1193–1201`), `sharedWith`, `entityDf`/`entityRarity` (they depend on
which entities the *window* named), `windowTerms`, and everything in the scan after `:528`.

## Build

1. **Gazetteer cache** in `keywordQuery.ts`, around the existing `buildGazetteer` call. Key: the exact ordered input —
   e.g. a string joining, for each `GazetteerName` in the order passed, `kind`, `id` and `name` with separators that
   cannot occur ambiguously (`\0`/`\u0001`). Order matters (first writer wins), so the key keeps order. The key string
   *is* the input, so a hit is exact by construction.
2. **Pool term profile cache.** Split the window-independent half out of `buildEvidenceProfile` in `entities.ts`: a
   function that, given `entryTexts`, returns `{ termsByText: ReadonlyMap<string, ReadonlySet<string>>, termRarity:
   ReadonlyMap<string, number>, entryCount }` computed with exactly today's arithmetic (`rarity(df, entryCount)`).
   `buildEvidenceProfile` takes it as an optional input (computing it itself when absent, so the other caller —
   `entitySearch.ts` / any test — is unaffected) and uses it for `termRarity` and to seed `termsOf` lookups. `termsOf`
   must still answer for texts not in the pool: give it a **per-call** local `Map` that falls back to the cached read-only
   `termsByText` — never write into the shared cached map. Cache it in `keywordQuery.ts` (or `entities.ts`; say which)
   keyed by a sha256 over `entryTexts.length` and each text separated by `\0`; the cache entry keeps the `entryTexts`
   array copy and **on a hit verifies `length` and every element with `===`** before using it — mismatch ⇒ recompute
   and replace. With that check a stale answer is impossible, not merely improbable.
3. **Bounded LRU**: one small LRU per cache (a `Map` with delete-and-reinsert on hit, evict oldest past a module
   constant, e.g. 16 — one slot per (book, lane) pool in recent use). `keywordQuery` receives no lorebook id or
   `updated_at`, so the key is content, not book id — state this in your report: why content keying cannot serve a stale
   answer (any entry write that matters changes a name, a key or content, hence the input, hence the key; a write that
   changes none of them cannot change these two structures).
4. Shared cached objects are read-only to consumers: verify nothing mutates `gazetteer.byName`, `matcher.keys`, or the
   cached `Set`s/`Map`s (grep `entities.ts`, `keywordQuery.ts`, `mentions.ts`, `entitySearch.ts`). `CompiledMatcher.re`
   is a global (`g`) regex: `runMatcher` resets `lastIndex` and uses `matchAll` (which clones) — confirm every user of
   `matcher.re` is safe when the same object is reused across calls, and say so.
5. `keywordQuery`'s signature and `KeywordQueryResult` do not change. `src/lib/server/pipelines/runtime/bindings.ts`
   and `runtime/host.ts` are **not yours and must not be touched** (a peer session is editing them now). If you think a
   line there must change, write the exact line in your report instead.
6. Any test-only reset helper you add: one, minimal, name it in your report.

## Measure (before and after)

Before editing anything: write a temporary benchmark test beside `keywordQuery.ts` (e.g.
`src/lib/server/pipelines/ranking/keywordQuery.perfG.bench.test.ts`) that builds a 200-entry pool (varied names,
2–4 keys, 300–800 chars of content each, some multi-word names), ~10 cast `entityRefs`, ~20 messages, default
`retrieval` params as the existing `keywordQuery.test.ts` fixtures use, and a cheap `countTokens`. Time 50 calls with
the **same** input (`performance.now()`), print p50 and p90; also time 50 calls where the messages change each call but
the pool does not (the real per-turn shape). Record numbers before your change and after. **Delete the benchmark file
when done** (it is not a permanent test); paste its numbers in your report.

## Tests (permanent)

In `src/lib/server/pipelines/ranking/keywordQuery.test.ts` and/or `entities.test.ts`:
- **Hit equals cold:** two calls with the same input deep-equal each other and a cold computation (reset helper, or a
  structurally equal copy of the input with fresh string identities).
- **Invalidation:** an entry write changes the ranking on the next call — e.g. edit one entry's content so it now shares
  the window's rare term (or rename an entry to a name the window says) and assert the result moves and equals a cold
  computation over the edited pool. One test for the gazetteer key (name change / cast change), one for the pool key
  (content change).
- **Verification on hit:** the pool cache rejects an entry whose key matches but whose texts differ (exercise the `===`
  check directly on the split-out function or via a test seam; keep the seam minimal).
- Keep green: `keywordQuery.test.ts`, `entities.test.ts`, `boundedPattern.test.ts`, `entitySearch.test.ts`,
  `mentions.test.ts`, `keyProposal.test.ts`, `keylessCorpus.test.ts` (all in `src/lib/server/pipelines/ranking/`).

## Files owned (the only files you may edit)

`src/lib/server/pipelines/ranking/keywordQuery.ts`, `src/lib/server/pipelines/ranking/entities.ts`,
`src/lib/server/pipelines/ranking/keywordQuery.test.ts`, `src/lib/server/pipelines/ranking/entities.test.ts`, and the
temporary benchmark file (deleted at the end).

## Files readable

Anything. Notably `ranking/signals.ts` (`tokenize`), `ranking/entitySearch.ts`, `ranking/mentions.ts`,
`ranking/keyProposal.ts`, `src/lib/server/annotations/index.ts:540–560` (another `buildGazetteer` caller — leave it).

## Out of scope

Caching the scan, `extractEntities`, or anything window-dependent. `bindings.ts`, `host.ts`. `annotations/`,
`keyProposal.ts`. Registry/boot/db files (another worker owns them). Any new setting.

## Rules you work under (quoted)

- Owner 2026-11-13: *"change how often, never what… retrieval ranks the same entries."*
- P1: *"a cache is keyed so a stale answer is impossible; name key and invalidation in the report, one test each."*
- Plan Part 1: *"A lane that finds itself changing an answer rather than how often it is computed has left its brief and stops."*
- Decisions: implementation inside scope is yours — name each choice in the report. Anything a user sees, or a new
  setting/table: stop and ask in your report. Findings outside scope go under **Noticed, not done**, never fixed in passing.

## Stop and ask when

Any existing test's ranking output changes; the key cannot be made exact; a change in `bindings.ts`/`host.ts` seems needed.

## Done means

All listed ranking tests green (`npx vitest run <file>` each, never the whole suite), plus the new tests;
`npx prettier --check <each changed file>`; `npx tsc --noEmit -p . 2>&1 | grep -E "ranking/(keywordQuery|entities)"` empty;
the benchmark file deleted.

## Report

Return in your final message (do not write a report file): changed files; the two cache keys and why each cannot be
stale; LRU bound; p50/p90 before/after for both benchmark shapes; tests run with pass counts; the `matcher.re` reuse
check; anything queued for `bindings.ts`; open questions; Noticed, not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should need none.)
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Inside `db.transaction(async (tx) => …)` use only `tx`.
- Never `git checkout`, `git restore` or `git stash`. Other uncommitted files in the tree belong to other lanes; never touch them.
