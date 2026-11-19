# BRIEF — perf-4 worker w1 — the two fields-only settings readers stop building the whole document (cut 1)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-4`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: do not run it at all. Both repos are staged by the lead: run no git command that changes
the index or the working tree: no add, reset, checkout, restore, stash, commit. `git show :<path>` and `git diff`
are fine. Never `prettier --write`. Other tasks are editing other files right now (client session forms and views,
`pipelines/registrations/summarizer.ts` and its importers): touch none of them, and re-read a file right before you
edit it.)

## Goal

Two readers build the whole session settings document (`resolveSessionSettings`, `src/lib/server/sessions/settings.ts:96`:
guests, tags, rebinds, overrides, the whole cast read, timeline, pipelines… about 100+ statements) and then read only
`doc.fields`:

- `sessionKeepsEveryTurn` (`src/lib/server/sessions/settings.ts:362-369`), called once per member per actions push
  (`messages/verbs.ts` 724–731 and 767–779);
- `sessionSpeechSettings` (`src/lib/server/pipelines/speech/sessionSpeech.ts:17-37`), called after each settled
  reply (`speech/onMessageSettled.ts:196`, `speech/resolveVoice.ts:202`, `pipelines/runtime/dispatchSpeech.ts:528`).

`fields` depends only on the session row's `genreId` / `presetId` / `genreFields`, the genre declaration and the
preset row: `resolveSessionSettings` sets `fields: await cascadeSessionFields(db, session, genre)` (`settings.ts:236`)
with `genre = await getSessionGenre(db, session.genreId ?? STANDARD_GENRE_ID)` (`:108-109`), and
`cascadeSessionFields` (`pipelines/entities/sessionGenres.ts:557-576`) reads only those three columns. The fields-only
read already exists: `genreFieldsFor(db, sessionId)` (`sessionGenres.ts:430-453`) selects those three columns, calls
the same `getSessionGenre` and the same `cascadeSessionFields`, and returns `{}` on a missing session **or on any
error** (it swallows). Re-verify every line number first.

## Exact change (no new function, no new export, no new name)

1. **`sessionKeepsEveryTurn`** (`settings.ts`): read the fields through `genreFieldsFor(db, sessionId)` instead of
   `resolveSessionSettings(db, sessionId)`; keep the rest (`keep === undefined ? undefined : keep === true`). Add
   `genreFieldsFor` to the existing import from `$lib/server/pipelines/entities/sessionGenres` (`settings.ts:77-81`).
   Nothing else in `settings.ts` changes. Why this is safe: a missing session gave `undefined` before (doc `null`)
   and gives `undefined` now (`{}`); a failing read threw before and both callers turned the throw into `null`
   (`verbs.ts` 753–756 and 779–782); now `genreFieldsFor` returns `{}` → `undefined` → both callers return `null`
   at their `keepsEveryTurn === undefined` line. Same answer; only the `console.warn` on that failure is no longer
   printed. Check this against the code and say so in your report.
2. **`sessionSpeechSettings`** (`sessionSpeech.ts`): keep today's fallback exactly. `genreFieldsFor` cannot tell
   failure from empty, so do **not** call it here. Compose the same reads without a catch inside the first `try`:
   select `{ genreId, presetId, genreFields }` of the session row (as `genreFieldsFor` does); if a row is found,
   `getSessionGenre(db, row.genreId ?? STANDARD_GENRE_ID)` then
   `return readSpeechSessionSettings(await cascadeSessionFields(db, row, genre))`; if no row, or anything throws,
   fall through to the existing raw `genre_fields` read below it, unchanged (today a missing session also reached
   that read, via `doc == null`). Import `cascadeSessionFields`, `getSessionGenre`, `STANDARD_GENRE_ID` from
   `$lib/server/pipelines/entities/sessionGenres`; drop the now-unused `resolveSessionSettings` import. Update the
   file's header comment only as far as it is now wrong ("through the session settings cascade … falls back to the
   raw `sessions.genre_fields` when the cascade cannot be read"): comments state the rule, never the history.
   `sessionEnvoySpeech` is untouched.

Touch nothing else. Do not move code, rename, or reformat lines you don't change. House style: tabs, double quotes,
no semicolons.

## Proof and tests

**A. Frozen literals from the code before the change.** `settings.ts` and `sessionSpeech.ts` in the working tree
are identical to the index today (checked by the supervisor with `git diff`); confirm with
`git diff --stat -- src/lib/server/sessions/settings.ts src/lib/server/pipelines/speech/sessionSpeech.ts` (must print
nothing) **before editing anything**. Then, before editing, write the permanent test (B) with a capture mode: run it
once against the unchanged code and print each reader's output as JSON (to
`/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/perf4/w1-before.json`),
then paste those values into the test as frozen literals (`toStrictEqual` / `toBe`), remove the capture code, make
the change, and run the test green. (If the diff check is not empty, instead copy the staged files with
`git show :<path>` into scratch modules beside them, capture from those, and delete the scratch files after.)

**B. Permanent test** `src/lib/server/sessions/settings.fieldsReaders.int.test.ts`:
- Sessions in five genres, Story, the Lair, Dungeon Crawler, Guide and Chat (find the genre ids and an existing
  fixture that creates sessions per genre, e.g. `sessions/honorModeRetired.int.test.ts`,
  `pipelines/runtime/dispatchSpeech.store.int.test.ts`, `sockets/sessions.dungeonCrawlerFixTurn.int.test.ts`), each
  **without** overrides and **with** overrides: stored `genre_fields` that set `keepEveryTurn` (where the genre
  declares it) and the speech keys `readSpeechSessionSettings` reads (`$lib/shared/sessions/speechSettings`), and
  one case through a preset that sets them (a `presetId` whose layer `presetLayerValues` reads). Plus a missing
  session id.
- For each: `sessionKeepsEveryTurn(db, id)` and `sessionSpeechSettings(db, id)` equal the frozen literals captured
  in A.
- Each reader issues fewer statements than `resolveSessionSettings(db, id)` (count by wrapping `db.$client.query`,
  as `src/lib/server/sockets/sessions.actionsOnce.int.test.ts` `counting` does); print the two counts per genre in
  the report.
- **Today's speech fallback is kept:** when the cascade fails, `sessionSpeechSettings` returns
  `readSpeechSessionSettings(<the row's raw genre_fields>)`. Make the cascade throw without touching production
  code: e.g. a second `describe` file is not wanted, so use `vi.spyOn` only if it can intercept the call (an ESM
  named import inside the module usually cannot); otherwise `vi.mock("$lib/server/sessions/exposure", …)` with a
  switch (a module-level flag the mock's `presetLayerValues` checks and throws on). Capture this case's value in A
  too (before: `resolveSessionSettings` → `cascadeSessionFields` → the same throw → the raw read).

`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`.

Run only as (one at a time, always at least one path; never pipe vitest into `head`):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-4-w1-<n>.log 2>&1"`

Done means green: the new file, `src/lib/server/sessions/honorModeRetired.int.test.ts`,
`src/lib/server/sockets/sessions.dungeonCrawlerFixTurn.int.test.ts`,
`src/lib/server/pipelines/speech/messageLine.int.test.ts`,
`src/lib/server/pipelines/runtime/dispatchSpeech.store.int.test.ts`,
`src/lib/server/pipelines/runtime/dispatchSpeech.members.int.test.ts`; then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-4-w1-tsc.log 2>&1`: 0 errors (if errors
appear in files you did not touch, list them and say they are not yours). Do not run the two baseline tests (the
supervisor does).

## Rules (quoted from the lane's contract)

- "No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical …; what any read
  returns, the order of writes and what every socket push carries to each member are unchanged. No caching across
  runs or across pushes."
- "Cut 1 adds no function. The fields-only read exists: `genreFieldsFor` … Point `sessionKeepsEveryTurn` and
  `sessionSpeechSettings` at it. … `sessionSpeechSettings` today falls back to the raw `genre_fields` when the full
  document fails … **keep today's fallback** (if `genreFieldsFor` cannot tell failure from empty, compose the same
  reads in `sessionSpeech.ts` without the catch, through `cascadeSessionFields`; say which you did). Nothing new in
  `settings.ts` beyond the reader's own lines."
- "Cut 1's test uses frozen literals, not 'deep-equals the full document' (both sides run the same cascade)."
- Files you may edit: `src/lib/server/sessions/settings.ts` (only `sessionKeepsEveryTurn`'s body and the one import
  line), `src/lib/server/pipelines/speech/sessionSpeech.ts`, the new test. Nothing else.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`." CLAUDE.md: "It is a **session**, never a
  *chat*" (Chat is a genre's name; fine in a fixture). Never seed a row at a hardcoded id.
- `npx prettier --check` only, never `--write` (the edited files may already fail it; report, don't fix).

## Stop and ask when

The two readers would return anything different from the frozen literals; `fields` turns out to depend on something
other than the three columns, the genre and the preset; a test fails for a reason you cannot tie to your change.

## Report (final message, under ~350 words)

Changed files; the diff check result; which way you did item 2; the error-path check of item 1; the capture and the
literals; statement counts per genre (reader vs full document); tests with results (log paths); tsc; prettier;
noticed, not done.
