# BRIEF — perf-D worker 1 — compiled templates cached, local token counts memoised

You are a `lane-worker` under lane supervisor `perf-D`. Repository root: `/home/jody/github/serene-pub`.
Use absolute paths. Read only line ranges of large files.

## Goal

Two caches on the turn path. Each computes exactly what it computes today, fewer times. Owner ruling 2026-11-13:
"change how often, never what" — a cache here is keyed so a stale answer is **impossible**, not unlikely.
Owner principle P1 (2026-11-04): "Same inputs, same result." No cache may make a render or count depend on what ran
before it.

### A. `src/lib/server/pipelines/prompt/renderers.ts` (review row C4)

Today `renderHandlebars` (~line 109) does `Handlebars.create()` + `registerContextHandlebarsHelpers(...)` +
`handlebars.compile(ctx.template)` on every render, and `renderLiquid` (~line 152) does `createContextLiquid(...)` +
`parseAndRenderSync` on every render. The helpers/tags close over `promptFormat`, which is why the comments insist on
a fresh instance — that reason stays true, so the cache must be keyed on the format.

Build:
- One module-level bounded LRU (a `Map`, refresh on hit by delete+set, evict the oldest past the limit) of compiled
  render functions `(variables) => string`, limit **128**. Key = engine id + template source + **format key**, joined
  with a separator that cannot be confused (e.g. `"\u0000"`).
- The format value is `ctx.completionTemplate ?? promptFormatOf(ctx.promptFormat)` exactly as today. Format key: the
  string itself when it is a string; `JSON.stringify(row)` when it is a `CompletionTemplate` row (content-keyed, so an
  admin's edit of the row is a different key — never stale). The cached entry must close over **its own copy** of
  the format: `structuredClone` the row before passing it to `registerContextHandlebarsHelpers` / `createContextLiquid`,
  so a caller mutating its row object later can never change a cached entry.
- Handlebars: on a miss, `Handlebars.create()`, register helpers with the copied format, `compile(ctx.template)` (no
  new options), store the compiled function. Liquid: on a miss, `createContextLiquid({ promptFormat: copy })`,
  `liquid.parse(ctx.template)`, store `(vars) => String(liquid.renderSync(tpl, vars))`. Confirm in
  `node_modules/liquidjs` that `parseAndRenderSync` is `renderSync(parse(...))` with the same defaults; say so.
- Jinja2 (`renderJinja2`) and plugin engines are untouched.
- A parse that throws stores nothing. Rewrite the two "⚠ A FRESH Handlebars per render" / "A fresh instance per
  render" comments in `renderers.ts` to say what is true now (cached per engine + source + format; why the format is
  in the key). Do not edit `contextHandlebarsHelpers.ts` or `contextLiquid.ts` (not ours) — tell me which of their
  comments are now stale.
- Export a test-only `_resetTemplateCache()` only if a test needs it.

Tests — new file `src/lib/server/pipelines/prompt/renderers.cache.test.ts`:
1. Two formats, same template source, render differently — for Handlebars (`core:template/handlebars@1`, use a
   `{{#systemBlock}}x{{/systemBlock}}`-style block helper — check the real helper names in
   `src/lib/shared/utils/contextHandlebarsHelpers.ts`) and for Liquid (`{% systemBlock %}x{% endsystemBlock %}` —
   check names in `contextLiquid.ts`), e.g. `"chatml"` vs `"vicuna"` keys, interleaved A, B, A.
2. Write invalidates: a `CompletionTemplate` row rendered once, then the same `key` with edited `roles` (a new object,
   and separately the SAME object mutated in place) renders the new framing / the old one respectively as content
   dictates — i.e. the edited content always shows; the mutated-in-place case must not corrupt a later render of the
   original content.
3. Same template, different variables → different output (the cache holds the template, never a result).
4. The bound: render 129+ distinct sources, the map never exceeds 128 (expose size via the test-only reset helper's
   module or a `_templateCacheSize()`; keep test-only exports minimal and prefixed `_`).
5. Benchmark (see below).

### B. `src/lib/server/pipelines/runtime/tokenizers.ts` (review row C5)

The llama, llama3, mistral and the three gpt counters (`OPENAI_GPT2`, `OPENAI_GPT4`, `OPENAI_GPT4O`) encode every
call. `src/lib/server/connections/backendTokenCount.ts` ~lines 163–220 already has a content-keyed LRU:
`keyOf` (sha1 base64 of the text) and `CACHE_LIMIT = 8000`, refresh on hit by delete+set, evict the first key past the
limit. Build:
- In `backendTokenCount.ts` change ONLY `const keyOf` → `export const keyOf` and `const CACHE_LIMIT` →
  `export const CACHE_LIMIT`. Nothing else in that file.
- In `tokenizers.ts`, one small helper that wraps a counter `(v) => number` in a per-tokenizer `Map<string, number>`
  with exactly that shape: key `keyOf(text(v))`, same limit, same refresh and eviction. Apply it to those six
  counters only (not cohere, not the encoders further down). Key per tokenizer (one map per counter), so two
  tokenizers never share an answer.
- Update the file's comments where they say what is cached.

Tests — extend `src/lib/server/pipelines/runtime/tokenizers.test.ts` (read it first):
1. Same text twice → same count as an un-memoised direct call into the package (compare with the package's own
   encode length).
2. Write invalidates: text A counted, text A edited to A' → A' count equals the package's count for A' (content key).
3. Two tokenizers (e.g. llama and mistral) on one text each give their own package's count.
4. Benchmark (see below).

## Benchmarks (required numbers)

In each new/extended test file add a `describe.skipIf(!process.env.PERF_BENCH)("bench", …)` that runs **50
iterations** and `console.log`s the p50 in ms (sort, take index 25). No timing assertions. Renderer: one realistic
~2 KB Handlebars template with a block helper and a few `{{#each}}` over a 20-item array, same format, 50 renders;
likewise Liquid. Tokenizer: llama3 and gpt4o on a ~4 KB English text, 50 counts.

**Measure BEFORE you change the source:** write the bench first, run it against the unchanged code with
`PERF_BENCH=1 npx vitest run <file> -t bench`, record the p50s, then build, then run again. Report both. Also report the
first-call (miss) cost after the change for the tokenizer (the sha1 is added on a miss).

## Files owned

`src/lib/server/pipelines/prompt/renderers.ts` · `src/lib/server/pipelines/prompt/renderers.cache.test.ts` (new) ·
`src/lib/server/pipelines/runtime/tokenizers.ts` · `src/lib/server/pipelines/runtime/tokenizers.test.ts` ·
`src/lib/server/connections/backendTokenCount.ts` (the two `export` keywords only).

## Files readable

Everything.

## Out of scope

Any other file. Jinja2 and plugin engines. The cohere counter and the id encoders. Any new setting. Any change to
what a render or a count returns.

## Stop and ask when

A cache cannot be keyed so a stale answer is impossible; a helper or tag turns out to hold state across renders
(then stop and tell me which); a name visible outside the module is needed beyond `keyOf`/`CACHE_LIMIT` exports and
`_`-prefixed test helpers.

## Done means

All green, run individually with `npx vitest run <file>`:
- `src/lib/server/pipelines/prompt/renderers.cache.test.ts`
- `src/lib/server/pipelines/prompt/renderers.jinja2.test.ts`
- `src/lib/server/pipelines/prompt/liquidParity.test.ts`
- `src/lib/server/pipelines/prompt/assemble.test.ts`
- `src/lib/server/pipelines/prompt/assembleExplicitLayouts.test.ts`
- `src/lib/server/pipelines/prompt/assembleSafeValues.test.ts`
- `src/lib/server/pipelines/prompt/cachePrefix.test.ts`
- `src/lib/server/pipelines/prompt/characterLoreBand.test.ts`
- `src/lib/server/pipelines/prompt/currentDate.storyTime.test.ts`
- `src/lib/server/pipelines/runtime/tokenizers.test.ts`
- `src/lib/server/pipelines/runtime/tokenizers.int.test.ts`
- `src/lib/server/connections/backendTokenCount.test.ts`
- `npx tsc --noEmit -p .` filtered to your files (`2>&1 | grep -E "renderers|tokenizers|backendTokenCount"`), none.
- `npx prettier --check <each changed file>` (report the result; if a file already failed prettier before your
  change, say so rather than reformatting the whole file).

## Report

Reply with: changed files; tests with pass counts; before/after p50 numbers; each cache's key and what makes a stale
answer impossible; stale comments in files you do not own; anything you noticed and did not do.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should need no `sdk:build`.)
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- Never `git checkout` / `restore` in either repo. Never `prettier --write` on a directory. Never `kill -9` a dev server.
- Other uncommitted files in the tree belong to other lanes; never touch them.
