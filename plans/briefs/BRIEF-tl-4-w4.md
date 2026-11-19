# BRIEF — worker `tl-4-w4` — Story's description (SDK copy); Dungeon Crawler counts its days from the session's first day

Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (edit the SDK **there**). Supervisor: lane
`tl-4`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout / restore / stash` in `../serene-pub-sdk` (most of it is uncommitted); never `prettier --write`;
never `pkill -f` a generic pattern; no migration; no `npm run build`; no full app test run. Lane `kn-5` edits SDK docs and may
run `sdk:build` too: **never edit SDK docs**, and before your `sdk:build` also wait until no other SDK build runs:
`until ! pgrep -af "serene-pub-sdk" | grep -Eq "tsc|build|tsup|vite build"; do sleep 10; done`, plus no vitest
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`) and `pgrep -af "vite"` shows no dev / preview server (the
Svelte language server's esbuild does not count). Build only from the app root: `npm run sdk:build`. **Re-read every file
right before you edit it.**

## Rules your work depends on (quoted)

- CLAUDE.md Decisions: "Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees or that
  outlives the change: … a new name / setting / flag …". NOMENCLATURE R1 "One word, one meaning"; R3 "Qualify, never the bare
  noun"; R6 mark provisional vocabulary 🚧. Note **"Beginning" / "Began at"** already means an entry's start date (do not reuse
  "began"/"beginning" for this).
- CLAUDE.md: "after any SDK change run `npm run sdk:build` before app tests"; "0.6 is in users' hands … Removing or renaming a
  published SDK name is the owner's call" (add nothing published; change no published name).
- Owner 2026-11-16 (D53b): "Say 'story time when the lorebook keeps it'". Owner 2026-11-16 (D52a): "There shouldn't be a
  scenario where it defaults to 1-1-1."
- The lead's correction (rules over older text): **no date is written by the Dungeon Crawler.** `clockLabel` counts the crawl's
  days **from the session's first day** (day 1 = the day the session's clock started on), so "Day 1, 08:00 → Day 1, 16:00."
  prints whatever the calendar date is, and the pinned test passes **unchanged**. "Find the anchor in what is stored (the
  session's first clock stamp, the earliest message / scene stamp, or the create receipt): the cheapest that is stable across
  Back, a rest and a branch. If nothing stored can give it without a new stored fact, stop on this item and report the smallest
  fact needed (no migration in this lane). The Lair has no day labels: no change."

## Item 2 — Story's description

SDK `core-catalog/src/registry/genres.ts` ~556: "…On Living the world keeps itself: after each round it notes what changed —
health, time, conditions — and every few turns…". Make "time" say **story time when the lorebook keeps it**, fitted to the
sentence (keep it one readable sentence; e.g. "— health, conditions and, when the lorebook keeps it, story time —"; your
wording is ★). Grep the app `docs/` and the SDK (not its docs) for any copy that quotes it; `docs/genre-story.md` if it
paraphrases "time" after each round.

## Item 5 — Dungeon Crawler day labels

Today `clockLabel` (SDK `core-catalog/src/genres/dungeon-crawler/storyScripts.ts` ~112–121; used in `rest.ts` ~159–160,
`story.ts` ~224, `journal.ts` ~144) counts days from Year 1 (`DUNGEON_CRAWLER_EPOCH = '1-01-01 08:00'`, `create.ts:45`), so a
session on the real calendar prints "Day 739445". The pinned test:
`src/lib/server/sockets/sessions.dungeonCrawlerRounds.int.test.ts` expects "Day 1, 08:00 → Day 1, 16:00." (failing now).

Supervisor's findings to verify (not proof):
- The scripts read the story now from the cast read: `own(v.cast).storyTime.now` (`rest.ts` ~122, `story.ts` ~170). The cast
  read builds `storyTime` in app `src/lib/server/pipelines/runtime/host.read.sessionCast.ts` ~550–600, with one select of the
  book row (`storyBookRow`). Nothing the scripts receive today carries a first day (`progress` annex keys don't either).
- Stored candidates: `session_messages.story_clock_*` (each message's stamp; a branch **copies** messages with their stamps,
  `sessions/branch.ts` ~185, ~458; Back retracts recent messages, not the first), `scenes.opened_story_clock_*`, the session's
  own clock (moves).
- Likely cheapest: the session's **earliest live stamped message** (live = `liveMessageWhere` in `messages/store.ts`), its date,
  folded as a scalar subquery into the existing `storyBookRow` select so the cast read costs **no extra statement**; passed as a
  new 🚧 key on `storyTime` (suggested name `sessionStart`; the name is ★, check NOMENCLATURE §24 / §9 for a collision and say
  what you found). Absent when no message is stamped or the timeline is off. In the scripts, `clockLabel(clock, start)` counts
  `day(clock) − day(start) + 1` with the same day arithmetic, and when `start` is absent counts from the clock being labelled's
  own first reference in that script (e.g. in `rest.ts` `start || was`; in `story.ts` / `journal.ts` `start || clockBase`), so
  a crawl with nothing stamped yet prints Day 1. Verify: stable across Back, a rest, a branch; the pinned test passes unchanged;
  a session started on a chosen date or an existing lorebook with a present counts from that date.
- If the anchor needs a new **stored** fact, stop on item 5 and report the smallest one. If it needs more than 0 extra
  statements per turn, say how many and why before building.
- Check `docs/genre-dungeon-crawler.md` (~40, ~184, ~231, ~237 say "Day 1 / Day 2"): change only a sentence that becomes false.
  Check whether the client formats "Day N" itself anywhere (Table talk, ~40) and report.
- Leap days: the scripts' month table has no leap day; say in the report whether a crawl spanning 29 February is off by one
  (don't fix unless trivial and inside `clockLabel`).

## Build and tests

1. After the SDK edits: `npm run sdk:build` from the app root (precautions above).
2. `npm run sdk:test`, capped: `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p
   MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/tl-4-w4-sdk-<n>.log 2>&1"` (wait for no vitest first). Four
   failures are known and not yours: list any others. A registry / spec hash pinned in a test that moves because of your copy or
   script change: re-pin it with a comment "(was <old>)" (SDK tests and app tests alike).
3. App tests, only this form, one at a time, wait first:
   ```
   until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
   cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-4-w4-<n>.log 2>&1"
   ```
   Never pipe vitest into `head`. Run `src/lib/server/sockets/sessions.dungeonCrawlerRounds.int.test.ts` (must pass
   **unchanged**), the cast-read tests (grep `host.read.sessionCast` tests), any Dungeon Crawler rest / journal tests, and add
   a test: a crawl whose first stamped message is on day X and whose clock is two days later prints "Day 3, …"; a branch prints
   the same. Prompt baselines with `KN2_SHA_LOG=plans/tl-4-w4-shas.txt ` before `npx`:
   `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts`,
   `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts`; compare with `plans/tl-4-shas-after.txt` — shas and
   statement counts must not change.
4. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub` (wait first); report errors in
   your files. `npx prettier --check` your changed files.

## Files owned

SDK: `core-catalog/src/registry/genres.ts` (the Story `about` only), `core-catalog/src/genres/dungeon-crawler/{storyScripts,rest,story,journal}.ts`
(only what the anchor needs), SDK tests that pin a moved hash. App: `src/lib/server/pipelines/runtime/host.read.sessionCast.ts`
(the `storyTime` block only), new / existing tests for it and for the Dungeon Crawler day label, app tests that pin a moved
hash, `docs/genre-story.md`, `docs/genre-dungeon-crawler.md`. Anything else: stop and ask.

## Report (your final message, under ~450 words)

Changed files (both repos); item 2 sentence before → after (★); item 5: the anchor chosen and why (Back / rest / branch), extra
statements, the new key's name (★) and its NOMENCLATURE check; tests run (log paths, pass/fail), hashes re-pinned old → new;
baseline shas; doc changes; leap-day finding; client "Day N" finding; anything noticed but not done.
