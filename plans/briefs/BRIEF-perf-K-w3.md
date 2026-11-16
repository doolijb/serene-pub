# BRIEF — perf-K worker 3 — no vector on the entries wire (★P6) and the dead script path (★P11)

Supervisor: lane `perf-K` (`plans/briefs/BRIEF-perf-K.md`). Report to `plans/REPORT-perf-K-w3.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Owner rulings (2026-11-13) you are applying

- **★P6:** "Remove `embedding` from the `entries:list` wire row." (No client reader of the vector exists; the
  client reads `embeddingModel` and `vectorizedAt` to show whether an entry is vectorized.)
- **★P11:** "Delete `scripts/run.ts`, `scripts/engine.ts`, `RuntimeManager.ts` alias once tests are re-pointed."

## Step A — entries wire (`src/lib/server/sockets/entries.ts`, `listEntryRows` + `toListRow` ONLY)

Today `listEntryRows` (~l.211) and `toListRow` (~l.574) call `loadDefaultVectors` (`utils/lorebookEntries.ts:211`,
NOT yours), which selects the `vector` column, and pass the triple to `toEntryRow`, so every list row ships the
whole vector.

1. In `entries.ts`, add one small module-local helper that selects **only** `entryId`, `model`, `vectorizedAt`
   from `lorebookEntryVectors` with the same filters as `loadDefaultVectors` (default vector name, chunk 0) and
   returns the same `Map<number, EntryVector-shaped>` with `embedding: null`. Use it in `listEntryRows` and
   `toListRow` in place of `loadDefaultVectors`. The wire row keeps `embeddingModel` and `vectorizedAt`;
   `embedding` is `null` on every list row and every `entries:create` / `entries:update` targeted row built by
   `toListRow`.
   - Keep `embedding: null` rather than deleting the key: the shared type `LorebookEntry`
     (`src/lib/shared/entries/types.ts:327`, not yours) still declares `embedding: number[] | null`; making it
     optional is a shared-type change the supervisor queues. Say so in your report.
   - If `loadDefaultVectors` becomes unused in `entries.ts`, drop it from that file's import list.
   - Update the doc comment above `listEntryRows` (it says "The vectors are loaded and sent because they always
     were") to say the vector is no longer sent (★P6, 2026-11-13) and why the model/timestamp still are.
2. **The peer session's edits in this file stay exactly as they are.** This file has ~200 uncommitted lines from
   another session. Do not reformat, reorder or touch anything outside `listEntryRows`, `toListRow`, your helper
   and the import line. In particular: `refuseIfEarmarked` remains the last await before the write in
   `updateEntryHandler`, and the `entryEarmarkHandler` block is untouched. **Do not run `prettier --write` on this
   file.**
3. Readers check: run `grep -rn "\.embedding\b\|embedding:" src/lib/client src/lib/shared --include=*.ts --include=*.svelte`
   and `grep -rn "embedding" ../serene-pub-sdk/*/src --include=*.ts | grep -i entr`. If any client or SDK code reads
   the vector off an `entries:*` row, **stop and report it** (do not build around it). Tests and test fixtures
   that merely construct `embedding: null` are fine.
4. Doc: `docs/lorebooks.md` — find where it explains vectorized badges or embeddings for entries (grep
   `vector\|embedd`); if there is a natural place, add one plain sentence for owners/modders only if the doc talks
   about what the list carries. If no such place exists, add nothing and say so. (The file has another lane's
   uncommitted edits — append, never rewrite.)

Tests: add a case (new file `src/lib/server/sockets/entries.listWire.int.test.ts`, modelled on
`entries.unfiledSceneCount.int.test.ts`): an entry with a stored vector (insert a `lorebook_entry_vectors` row) →
`listEntryRows` returns `embedding: null`, `embeddingModel` = the stored model, `vectorizedAt` set. If a cheap way
exists to call `toListRow`'s path (e.g. `updateEntryHandler`'s `entries:update` emit in an existing int test
pattern), assert the same there; otherwise say why not.

## Step B — delete the dead in-process script path

1. Delete `src/lib/server/scripts/run.ts` and `src/lib/server/scripts/engine.ts`.
2. `src/lib/server/scripts/abuse.test.ts` imports both:
   - `PINNED_ENGINE` (the `quickjs-emscripten` version pin check, ~l.39–50): keep the check by declaring the pin as
     a local constant **in the test** (`const PINNED_ENGINE = "0.32.0"` — copy the exact value from `engine.ts`
     before deleting it), with a one-line comment that it pins the engine the production host
     (`runScriptSource`) loads.
   - The `describe("run.ts contract — not (yet) true of the production host", …)` block (~l.311 onward) runs six
     cases against `runScript`. They cannot be re-pointed (the production host does not meet them). **Delete the
     block** and list each case's title in your report verbatim — the supervisor reports them to the owner as
     claims withdrawn with the file.
   - Remove the `runScript` import.
3. **Do NOT delete `src/lib/server/plugins/RuntimeManager.ts`.** `pipelines/runtime/pluginBindings.ts:58` (a
   production file in `pipelines/runtime/`, owned by a peer session and out of this lane's scope) still imports
   its type; the supervisor queues that one-line change. Leave `RuntimeManager.ts` and
   `pluginBindings.int.test.ts` as they are.
4. Run `grep -rnE "scripts/run['\"]|scripts/engine['\"]|scripts/run\.ts|scripts/engine\.ts|runScript\b" src ../serene-pub-sdk/*/src docs --include=*.ts --include=*.js --include=*.md`
   afterwards and fix any remaining **test** import in your owned set; report any non-test hit (code or doc)
   instead of fixing it — except the deleted files' own mentions inside `abuse.test.ts`.
5. `npm run test:budgets` must still run against the production host: run it (it runs
   `src/**/*.budgets.test.ts`, single-threaded) and report the result.

## Files owned (edit only these)

- `src/lib/server/sockets/entries.ts` (the helper, `listEntryRows`, `toListRow`, the import line — nothing else)
- new `src/lib/server/sockets/entries.listWire.int.test.ts`
- `docs/lorebooks.md` (append-only, one sentence at most)
- `src/lib/server/scripts/run.ts`, `src/lib/server/scripts/engine.ts` (delete)
- `src/lib/server/scripts/abuse.test.ts`

## Rules (quoted from CLAUDE.md and the lane brief — they bind you)

- "Sockets: `entries:*` events are scoped on `lorebookId`; nothing about that changes." Do not change any emit,
  event name or payload key other than the vector's value.
- "The peer session's edits in this file stay as they are: `refuseIfEarmarked` remains the last await before the
  write in `updateEntryHandler`, and the `entryEarmarkHandler` block is untouched."
- "Inside `db.transaction(async (tx) => …)` use only `tx`." If your helper is ever called with a `tx`, it takes the
  handle as a parameter like `loadDefaultVectors` does (`dbOrTx`).
- "Never seed a row at a hardcoded id."
- Do what was asked, at the size asked. Findings go under **Noticed, not done**. Introduce no exported name; the
  helper is module-local.
- Do not touch `db/schema.ts`, `drizzle/`, anything under `pipelines/runtime/`, `sockets/sessions.ts`, or the SDK.

## Hygiene (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You should not need `sdk:build`.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- Use absolute paths; the repo is `/home/jody/github/serene-pub`.

## Done means

Green in a capped scope: your new test, `src/lib/server/sockets/entries*.int.test.ts`,
`src/lib/server/sockets/lorebooks*.int.test.ts`, `src/lib/server/sockets/content.interestGate*.test.ts` (find the
exact name with `ls src/lib/server/sockets | grep -i interestGate`), `src/lib/client/lorebooks/bookPatches.test.ts`,
`src/lib/server/scripts/abuse.test.ts`; `npm run test:budgets` runs green. `npx tsc --noEmit -p .` shows no error in
your files (filter by path). `npx prettier --check` on each file you edited (say which were already unclean).

## Report (`plans/REPORT-perf-K-w3.md`)

Changed/deleted files; the reader grep results; the six withdrawn case titles verbatim; tests with pass counts;
**Noticed, not done**.
