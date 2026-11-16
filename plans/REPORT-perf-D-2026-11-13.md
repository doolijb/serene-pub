# REPORT — lane `perf-D` — 2026-11-13

Brief: `plans/briefs/BRIEF-perf-D.md`. Worker briefs: `BRIEF-perf-D-w1.md` (steps 2, 3), `BRIEF-perf-D-w2.md`
(steps 1, 6-part, 7, 8). Both worker reports checked against their briefs and the diffs read. Nothing committed.
Relayed status question: none received.

**Built:** steps 1, 2, 3, 7, 8, and the `sessionAsleep` half of step 6.
**Stopped (★ below):** steps 4 and 5. Neither cache can be keyed so a stale answer is impossible.
**Queued:** the `writtenAgoOf` half of step 6 (needs `state/resolve.ts`, which this lane does not own); the
narrator-label invalidation (write sites in `host.ts`).

## Changed files

| file | change |
|---|---|
| `src/lib/server/sockets/sessions.ts` | Only the named sites. **Send handler**: `getPromptSessionFromDb` replaced by `db.query.sessions.findFirst({ columns: { id } })`, with the same refusal. **`fireNarratorResponseHandler`**: one `select id … limit 1` over `session_messages` with the snapshot's exact filters (`session_id`, `is_hidden = false`, `channelWhere(main)`) plus `is_generating = true`. **`buildSessionRefresh`**: dropped the top-level `messages: rows`. **`sessions:update`** and **`reassignRemovedParticipant`**: `getSessionFromDB(…, "none")`. The hunks at ~3709, ~6010, ~6909 (scene summaries) and ~11281 (`fireTurn` "stopped") are another lane's. |
| `src/lib/server/pipelines/prompt/renderers.ts` | 128-entry LRU of compiled templates (Handlebars, Liquid). Jinja2 and plugin engines are untouched. |
| `src/lib/server/pipelines/prompt/renderers.cache.test.ts` | new, 12 tests + benchmark |
| `src/lib/server/pipelines/runtime/tokenizers.ts` | `memoised()` wraps llama, llama3, mistral, gpt2, gpt3.5, gpt4 and gpt4o. Cohere and the id encoders are not wrapped. |
| `src/lib/server/pipelines/runtime/tokenizers.test.ts` | memo tests + benchmark |
| `src/lib/server/connections/backendTokenCount.ts` | **Outside the brief's owned list:** only `export` added to `keyOf` and `CACHE_LIMIT`. Step 3 says "reuse its `keyOf` and limit", which cannot be done without exporting them. No other lane owns the file. Revert both words if you rule otherwise; step 3 would then need its own key function. |
| `src/lib/server/state/expressions.ts` | One lazily built shared `Liquid`. The scope, seed label and roll counter ride on a private register of a per-evaluation `Context` (`serene:expression-evaluation`, a module-private string that template text cannot reach). |
| `src/lib/server/state/expressions.test.ts` | interleave + roll-determinism tests + benchmark. Existing tests untouched. |
| `src/lib/server/rulesets/resolve.ts` | `sessionAsleep` only: reads `sessionLinks` once and passes `{ links }` to `valueOf`. Now `export` (for tests). |
| `src/lib/server/rulesets/sessionAsleep.int.test.ts` | new, 3 tests. No test covered `sessionAsleep` before. |
| `src/lib/server/sockets/sessions.refreshPush.int.test.ts` | 4 asserts read `session.sessionMessages` instead of the dropped `messages` |

My own edits after the workers: wrapped `OPENAI_GPT35` (my worker brief listed three gpt counters; there are four).
Reverted one unrelated prettier reflow in `tokenizers.ts` (`budgetConnectionOf`). Lower-cased one comment word in
`sessions.ts`.

## Caches: key and invalidation

| cache | key | why a stale answer is impossible | invalidation test |
|---|---|---|---|
| Compiled templates (`renderers.ts`) | `engine \0 template source \0 formatKey`. `formatKey` is the format string, or `JSON.stringify(row)` for a `CompletionTemplate` row. | Content-keyed: an admin's edit of the row is a different key. Each entry closes over its own `structuredClone` of the row, so a caller mutating its object later cannot reach a cached entry. It stores a compiled function, never a result: variables never enter the key. | `renderers.cache.test.ts`: two formats on the same source (Handlebars and Liquid, interleaved A/B/A); an edited row renders the new framing; a row mutated in place does not corrupt a later render of the original content; the LRU bound. |
| Local token counts (`tokenizers.ts`) | One `Map` per counter; key `keyOf(text(v))` (sha1). Limit `CACHE_LIMIT` (8000). Refresh and eviction match `BackendTokenCounts`. | Content-keyed, and a counter is a pure function of the text. One map per tokenizer, so no two tokenizers share an answer. | `tokenizers.test.ts`: text A, then edited A′, returns the package's own count for A′. Llama and mistral on one text each return their own package's count. |
| Expression engine (`expressions.ts`) | Not a cache: one stateless engine; all per-evaluation state is on the evaluation's `Context`. | Filters close over nothing. | `expressions.test.ts` "one shared engine": an own-property getter on A's `owner` runs whole evaluations on scope B (including two seeded rolls) in the middle of A. Both answer from their own scope and seed. Roll totals were recorded on the old engine and asserted unchanged. |

Liquid equivalence was checked in `node_modules/liquidjs` 10.29: `parseAndRenderSync` = `_render(parse(html))` with
`sync: true`, the same call `renderSync(tpl)` makes. `Liquid._evalValue` builds the same `Context` that `evaluate`
now builds itself, so render and memory limiters are still fresh per evaluation.

One deviation, accepted: Handlebars `compile()` is lazy, so a template with a syntax error is cached as a function
that throws the same error on every call. This is deterministic and stores no output, and a test covers it. Liquid
`parse` throws before anything is stored.

## Numbers (50 iterations, p50 ms; `PERF_BENCH=1 npx vitest run <file> -t bench`)

| step | case | before | after |
|---|---|---|---|
| 2 | Handlebars, 1.8 KB template, one format | 1.762 | ~0.11 |
| 2 | Liquid, 2.1 KB template, one format | 1.482 | 1.6–2.4 (no gain) |
| 3 | llama3, 4.2 KB text | 0.681 | 0.006 |
| 3 | gpt4o, 4.2 KB text | 0.062 | 0.006 |
| 7 | `owner.hp \| plus: 1` | 0.090 | 0.009 |

- **Liquid**: the benchmark template's 12 × 20-item `for` loops render through liquidjs's generator `renderSync`, and
  that render is the cost; construction and parse were not. A template with fewer loops gains more. Nothing is lost.
- **Tokenizer first call** (cache miss, sha1 added): 2.23 / 1.98 ms after, against 2.26 / 2.00 ms before. The
  difference is noise.

The benchmarks are skipped unless `PERF_BENCH` is set, so the grouped `npm test` stays quiet and has no timing
assertions.

## S rows: verified or not

| row | verified | finding |
|---|---|---|
| C6 (step 4) | **verified, not built** | `moments.ts:109–133` recounts every earlier turn line per landed line, as stated. The tally already stores `turn` and `lastMessageId`, but an increment gives a different number than the recount whenever an earlier turn line leaves the table after it was noted. Example: delete the last reply (tally `turn = 10`, `lastMessageId = 10`) and send again; the recount says 10, the increment says 11. Imported rows and branch copies diverge the same way. → ★D1 |
| C7 (step 5) | **verified, not built** | `dispatch.ts:575–590` scans `metadata->>'narratorName'` per dispatch, as stated. The narration rows are written in `host.ts` (~8678, `isNarratorResponse: narration`) and `sessions/goalsReached.ts:113`. Deleting or editing a narration line also changes the answer, and invalidating on landing would not see that. Per the brief, not shipped. → ★D2 |
| C8 (step 6) | **verified, half built** | `sessionAsleep` (`rulesets/resolve.ts:668`) re-read `sessionLinks` per seat; fixed. `writtenAgoOf` (:196) runs `valueStampsOf` per owner (`state/resolve.ts:1108`). Each call runs one `valueRows` query plus `rowsOnReading`'s entry-date and cut reads. Batching across owners needs `valueRows`, `chainFor` and `answeringLayer`, which are private to `state/resolve.ts` (not this lane's). With a `sessionId` the "book reading" is already `links.reading` (one read, shared). → Queued, ★D3 |
| C11 (step 8) | **verified, built** | Both update paths and the doubled refresh rows confirmed. The client reads `msg.session.sessionMessages` (`sessionPageData.svelte.ts:988` → `sessionStore.merge`); nothing in `src/lib/client` or `src/routes` reads the top-level `messages`. The `sessions:update` readers read `res.session.name` / `applySession` (no `sessionMessages`). The `reassign` reader reads only `success` / `error`. |

## Tests (each run by the worker individually; my re-run of 8 files after my edits: 135 passed, 5 bench skipped)

- Renderers: `renderers.cache` 12 · `renderers.jinja2` 4 · `liquidParity` 55 · `assemble` 51 · `assembleExplicitLayouts` 14 ·
  `assembleSafeValues` 10 · `cachePrefix` 7 · `characterLoreBand` 11 · `currentDate.storyTime` 5.
- Tokenizers: `tokenizers` 23 (+2 bench skipped) · `tokenizers.int` 7 · `backendTokenCount` 5.
- Expressions and rulesets: `state/expressions` 23 · `rulesets/engine` 25 · `methods` 24 · `resolve.int` 12 · `functions.int` 8 ·
  `writtenAgo.int` 5 · `memberForm.ctx.int` 2 · `sessionAsleep.int` 3.
- Sockets: `sessions.interestGate` 15 · `fireNarratorResponseLock.int` 2 · `refreshPush.int` 5 · `participantRemoval.int` 13 ·
  `messageLengthCap.int` 6 · `readOnlyMode.int` 2 · `lorebooks.memberSessionPush.int` 5 · `attachments.int` 12 ·
  `narrateDirection.int` 13.
- `npx tsc --noEmit -p .` filtered to every touched path: nothing.
- `npx prettier --check`: the new test files, `renderers.ts` and `tokenizers.test.ts` pass. `tokenizers.ts`,
  `expressions.ts`, `expressions.test.ts`, `rulesets/resolve.ts`, `sessions.ts`, `refreshPush.int.test.ts` and
  `backendTokenCount.ts` already failed prettier at HEAD (checked with `git show HEAD:<f> | prettier --check
  --stdin-filepath`). None was reformatted.
- No `/tmp/serene-pub-vitest-*` dir was left behind by my re-run (directory listing compared before and after).

## Queued for the runtime owner (`serene-pub-c4`) and for unowned files

1. **Step 5 invalidation (`host.ts`)**: only meaningful if ★D2 rules for a cache. The narration insert at
   `host.ts` ~8678 would call `forgetNarratorLabels(sessionId)` after the commit. Every delete, edit and rewind path
   of `session_messages` would need the same call (`messages/store.ts`, `sessions/rewind.ts`,
   `sessions/goalsReached.ts`, the delete socket). That spread is why I recommend against the cache.
2. **Step 6 `writtenAgoOf` (`src/lib/server/state/resolve.ts`, unowned; not the peer's)**: add next to
   `valueStampsOf` an export that takes `asks: { owner, slotIds }[]` and `known.links`. It would run one
   `valueRows(db, union of every ask's chainFor(owner, links), union of slotIds, sessionId, links.reading)` (one
   `rowsOnReading`), then call `answeringLayer(rows, chainFor(owner), slotId, reading.dates, links.placeValues)`
   per ask and slot. `writtenAgoOf` would then make one call instead of one per owner. Equivalence rests on
   `valueRows` already over-fetching (its `ownerKind IN … AND ownerId IN …` is a cross product) and on
   `answeringLayer` matching exact `(kind, id)`. Whoever builds it must confirm that before shipping. New exported
   name → ★D3.
3. **Stale doc comments in unowned files**:
   - `src/lib/shared/utils/contextHandlebarsHelpers.ts`, doc above `registerContextHandlebarsHelpers` ("Callers create
     a fresh `Handlebars.create()` per render"): it is now per cache miss, keyed on the format.
   - `src/lib/shared/utils/contextLiquid.ts`: the `createContextLiquid` doc says "One per render", and the `cache:
     false` comment says "every instance renders one template once". It is now one per cache miss; an instance
     renders one parsed template many times.
   - `src/lib/shared/sockets/types.ts` ~5060: `Refresh.Response` says it "Carries `session` (never null),
     `messages` and `coversFromId`". `messages` is no longer sent. The legacy optional `messages?` on `Get.Response`
     is untouched.
   - `src/lib/server/channels/lanePush.ts` header (~line 13) describes the payload as
     `{ session: { sessionMessages }, messages }`. The code narrows either array and needs no change.

## Open ★

- **★D1 (step 4, turn number).** The tally increment changes the turn number after a deleted, imported or copied
  line, so it breaks "change how often, never what". **Recommend: do not keep the turn on the tally. Keep the
  recount and make the query cheaper without changing its answer:** read `metadata ->> 'isGreeting'` straight off the
  `json` column instead of `::jsonb` (same semantics), and an index if W7-a's migration wants one. Trade-off: a
  smaller win than O(1). The O(1) version would need every delete, import and branch copy to reconcile the tally, a
  second writer of the tally's turn.
- **★D2 (step 5, narrator labels).** A per-session cache invalidated only when a narration lands is stale after a
  narration line is deleted or edited (its old name stays a stop string). **Recommend: no cache. Leave the scan, or
  narrow it with the same json-not-jsonb read.** Trade-off: one indexed scan of the session's rows per dispatch
  remains. A cache would need invalidation from every `session_messages` writer, which is P2's "two writers"
  problem in reverse.
- **★D3 (step 6, `writtenAgoOf`).** Needs a new exported function in `state/resolve.ts` (a new name, an unowned
  file). **Recommend: build it as queued item 2 in a lane that owns `state/resolve.ts` (W9 will).** Trade-off: until
  then, a ruleset with modules pays about one `valueRows` query plus reading reads per owner.
- **★D4 (`backendTokenCount.ts` exports).** Two `export` keywords in a file the brief did not list, required by
  step 3's own wording. Recommend: keep.

## Noticed, not done

- **W4-b (keyword gazetteer / DF cache), not built.** Not one of this brief's build steps. The DF half lives in
  `buildEvidenceProfile` (`ranking/entities.ts`), outside `keywordQuery.ts`. Only a gazetteer-only cache could
  stay inside `keywordQuery.ts` without touching the call site.
- `fireNarratorResponseHandler` no longer re-reads the session after the access check. A session deleted in the
  instant between the access check and the run now fails inside `runReply` instead of answering "session not
  found". The access check is a few lines earlier, under the same generation lock.
- `renderers.ts` exports `_resetTemplateCache()`, which no test uses (the tests use `_templateCacheSize()`). It is
  harmless; drop it if you want strictness.
- `tokenizers.ts` header still says core registers "eight loaders", which is true.
- The grouped verification (scope-reviewer on this diff, `npm test`, `check`, `build`) is the lead's.

---

## Lead's acceptance note (2026-11-13)

- **★D1 turn number: accepted as not built.** An incremented tally answers differently from the recount after a
  delete, import or copy; that is a changed answer, which Part 1 forbids. The recount stays. Its query may be made
  cheaper later without changing the result (W9 or a follow-up).
- **★D2 narrator labels: accepted, no cache.** Edits and deletes of narration lines also change the labels; a
  cache keyed only on "a narration landed" cannot be made stale-proof.
- **★D3 `writtenAgoOf` batching: deferred to W9**, which owns `state/resolve.ts`; the exact change is queued in
  this report.
- **★D4 `keyOf` / `CACHE_LIMIT` exported from `connections/backendTokenCount.ts`: accepted.** Two `export`
  keywords, no behaviour change, and the alternative was a second cache shape, which the brief forbade.
- The Liquid template cache shows no gain on the benchmark (render dominates); kept because it is the same code path
  as Handlebars and costs nothing, but a follow-up may drop it if it never pays.
- Noticed, carried: stale doc comments in `contextHandlebarsHelpers.ts`, `contextLiquid.ts`, `shared/sockets/types.ts`
  (`Refresh.Response`), `channels/lanePush.ts` header; `_resetTemplateCache` exported but unused.
- Scope review: no objection; the unused `_resetTemplateCache` export was removed by the lead.
