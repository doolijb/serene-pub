# BRIEF — perf-C-w2 — lorebook workspace: verify the per-edit cost, batch vectorized patches

You are a `lane-worker`. Lane `perf-C`; the lead is acting supervisor. Repository root `/home/jody/github/serene-pub`.
Read `plans/briefs/BRIEF-perf-C.md` in full first; this brief is its step 3, scoped down by the lead. The server
half (`perf-C-w1`) is dropping the full `entries:list` re-send after a single-entry create/update, so after it lands
the client receives ONE targeted `entries:update` per save instead of that plus a list. Other uncommitted files in the
tree belong to other lanes and a peer session: never touch them; never `git stash` or `git checkout`.

## Files you may edit

`src/lib/client/lorebooks/LorebooksWorkspace.svelte`, `src/lib/client/lorebooks/bookPatches.ts`, and tests beside
them (`src/lib/client/lorebooks/*.test.ts`).

## Do

1. **Verify review row D3** at `LorebooksWorkspace.svelte` `handleEntriesList` (~2016), `handleEntryUpdated`
   (~2078), `handleVectorized` (~2143) and the deriveds over `bookRows` (~474, ~743, ~771, ~911, ~936, ~1147). Count
   how many times each derived recomputes on one `entries:update` today (a quick vitest with a fake socket, or
   reasoning from the code — say which), and how many on a burst of N `vectorization:itemUpdated` messages.
2. **Do not** convert `bookRows` to a `SvelteMap` — 22 call sites, and with the relist gone a single update already
   replaces the type array once. The lead decided this; say so in the report.
3. **Batch vectorized patches per animation frame:** `handleVectorized` applies `patchEmbedding` and assigns
   `bookRows` per message; coalesce messages that arrive within one frame (`requestAnimationFrame`, falling back to a
   microtask/`setTimeout(0)` under test) into one `bookRows` assignment. Order and final state identical. If
   `patchEmbedding` in `bookPatches.ts` already supports applying several messages, use that; otherwise add a
   small `patchEmbeddings(rows, msgs, …)` beside it with a unit test in `bookPatches.test.ts`.
4. If step 1 shows `handleEntryUpdated` itself rebuilds every type's array even when the entry's type did not
   change (the loop at ~2084–2095), make the no-retype path return the same array references for the untouched
   types so unrelated per-type deriveds do not rerun. Nothing else.

## Done means

`npx vitest run src/lib/client/lorebooks/bookPatches.test.ts src/lib/client/lorebooks/bookCopy.test.ts
src/lib/client/lorebooks/castPool.test.ts src/lib/client/lorebooks/libraryRows.test.ts` green plus your new test;
`npx prettier --check` on changed files; `npx tsc --noEmit -p .` filtered to your files clean (Svelte files: run
`npx svelte-check --threshold error` only if it finishes in under 3 minutes on your machine; otherwise skip and say so).

## Report

`plans/REPORT-perf-C-w2.md`: the counts from step 1 (before/after), changed files, tests with results, Noticed-not-done.

## Rules (verbatim)

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Never pipe vitest into `head`. `$state(new Map())` / `new Set()` is not reactive: use `SvelteMap` / `SvelteSet` if you ever need one (you should not here).
- No new user-facing name, event or setting.
