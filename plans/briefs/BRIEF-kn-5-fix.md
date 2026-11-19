# BRIEF — worker task `kn-5-fix` — five scope-review fixes to lane `kn-5` (hand tie wins; one knowledge switch)

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (one comment only; **do not
run `sdk:build`**: lane `tl-4` builds the SDK later and picks the comment up). Read first:
`plans/REPORT-kn-5-2026-11-16.md`, `STYLE-GUIDE.md` §10 (help is one sentence). Re-verify every file:line.

Rules: never `git stash / checkout / restore` in either repo; `npx prettier --check` only; never commit; no
migration. Inside `db.transaction` only `tx`. Comments state the rule, not the story. Lane `tl-4` is editing
`sockets/import.ts`, three functions in `lorebooks/ownBook.ts`, history retrieval, SDK Dungeon Crawler files and
the Story genre's description: do not touch those. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-5-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Fixes

1. **The settings form must decide per read, as the panel does.** `src/lib/server/sessions/settingsForm.ts`
   ~762, ~798: a write equal to the majority inherited value clears **every** member, so a member whose own
   inherited value differs ends up with the opposite of what was written; the panel path decides per member
   (`planWrite` → `holdsRow`). Decide the clear per member (`same(value, h.inherited)`) inside `writeMembers`.
   Test: a pipeline whose reads inherit different values; writing true and writing false each leave every read
   resolving to the written value, through the form and through the panel, identically.
2. **Remove the unreachable fallback.** A non-admin is never sent a `params` option
   (`pipelines/config/panel/scopes.ts` 59–60) and no declaration gives this param owner reach, so "a viewer who
   cannot see every read gets the per-read switches" never happens: delete the `else if (ganged)` branch in
   `config/panel/read.ts` ~870 and the form's `else` at `settingsForm.ts` ~803 (verify they are unreachable
   first; if either is reachable, stop and say how). Correct the report's ★7 to "a non-admin sees no knowledge
   switch" and the docs if they repeat it.
3. **The Known by note** (`src/lib/client/lorebooks/knowledge/knownByWords.ts:82`): *"…stands over ‹tie›, which
   wins again at Default."* → *"‹Kept from / Knows› stands over ‹tie›; set it back to Default and that tie wins
   again."* (★). Update its tests.
4. **The tab's header line** (`KnownByList.svelte` 59–60, `docs/lorebooks.md:125`): *"…which win in that session
   unless a tie is set here by hand"* is untrue when the session's notes hold a hand tie of their own (the
   nearer wins). → *"…unless a tie is set here by hand and the session's notes hold no hand tie of their own."*
   (★), in the component, its test and the doc.
5. **One sentence of help when reads differ** (`settingsForm.ts` ~770–772): the form's description becomes two
   sentences; make it one (e.g. the help sentence stays and the *Set differently on ‹n› of this pipeline's
   reads* line is carried the way the form carries a row's secondary state, if it has one; else fold into one
   sentence: ★).
6. **SDK comment:** `../serene-pub-sdk/contracts/src/outlets.ts` ~2395 still says *"A hand tie set later still
   loses to an earlier dated tie…"*: delete that sentence (the rule is: a hand tie always wins). Comment only;
   no build.

Append a "Scope review and fix task" section to `plans/REPORT-kn-5-2026-11-16.md`.

## Tests

`config/panel/ganged.int.test.ts`, `config/panel/index.int.test.ts`, the settings form's tests
(`sessions/settingsForm*.test.ts`), `client/lorebooks/knowledge/*.test.*`. `tsc` 0.

## Report (under 250 words)

Per fix: what changed (file:line), sentences (★), tests and counts with log names, anything not done.
