# BRIEF — worker task `kn-6-fix` — scope-review fixes to lane `kn-6` (knowledge ties in Apply)

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (one source comment only; no
`sdk:build`). Read first: `plans/REPORT-kn-6-2026-11-17.md`, the "Cold review corrections" of
`plans/briefs/BRIEF-kn-6.md`. Re-verify every file:line.

Owner rulings: D41 "Offer it in Apply"; D39 "A hand tie always wins over what play wrote"; P1 (every automatic
action shows its cause and how to undo it); 2026-11-16 G2 "A guest neither opens nor edits the notes".

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree (no
add, reset, checkout, restore, stash, commit); `npx prettier --check` only; no migration. Inside
`db.transaction` only `tx`. Comments state the rule, not the story. Lane `gs-2c` is editing
`lorebooks/ownBook.ts` (**only** `isSessionMember` / `ownBookAccessFor`), `cast/characterRows.ts`,
`sockets/entries.ts`, notes entry points on the session page and many guest tests: in `ownBook.ts` touch only
the knowledge-tie functions and re-read right before each edit; do not touch its other files. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-6-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Fixes

1. **A superseded tie is removed in words.** `supersededTies` is used only at
   `src/lib/client/contexts/sessionOutcomes.svelte.ts:41` to suppress "Nothing to share", so an Apply whose only
   effect is that removal shows nothing. Add one sentence to Apply's outcome (the existing outcome surface in
   that context: the only place that toasts), ★: *‹n› knowledge ties removed: Knows or Kept from is set by hand
   for them in the lorebook.* (singular form too), shown whenever `supersededTies > 0`, alongside whatever else
   Apply reports. The duplicate count (`droppedTies`) follows the wording duplicates already get for links, if
   one exists; if links say nothing for a duplicate, say nothing here.
2. **One predicate for "a play tie held in the notes".** `dropSupersededKnowledgeTies`
   (`src/lib/server/lorebooks/entryKnowledge.ts` ~1100–1106) filters differently from the review's
   `heldKnowledgeTiesOf` (`lorebooks/ownBook.ts` ~1710–1735): it lacks `isNull(branchId)`, `isNull(rulesRunId)`
   and the check that the member and the entry are the lorebook's, so it could delete a ruleset run's row or a
   tie the review never offered. Build one shared predicate / query (owned by `entryKnowledge.ts`) that both
   use, so only a tie the review would list can be dropped as superseded. Test: a ruleset run's tie row and a
   tie on a session-only member are not deleted.
3. **One spelling.** `PLAY_KINDS` is spelled three times (`entryKnowledge.ts:1008`, `ownBook.ts:1696`,
   `host.loreWrites.ts:957`): export one constant from `entryKnowledge.ts` and use it in all three.
   `handTieInBook` re-spells `isHandTie` in SQL: keep the SQL (a query needs it), add one comment line pointing
   at `isHandTie` as the definition it must match, and one test asserting they agree on the four cases
   (kind × dated / undated × branch / main). Add the stored imprint key `cause.knowledgeTie` to the `kn-6` §25
   entry in `NOMENCLATURE.md`.
4. **The Apply review is the session owner's.** `src/lib/server/sockets/sessions.overlay.ts` 17–27 sends the
   review's items (`overlayItems`) to anyone in the session; the rows say which cast member knows what and what
   play wrote into the notes. Under G2 a guest gets none of it: the server answers a non-owner with no items in
   the handler's existing manner (find what a non-owner gets for the Apply / Take back actions today: they are
   already owner-only for a shared lorebook; make the **read** match), and the client's review panel
   (`SessionViewPanel.svelte`) is absent for a guest (no empty shell, no disabled buttons). The lane's
   "shared lorebook: everyone in the session sees the row" becomes "the session's owner sees the row". Tests on
   the serialised reply (guest: nothing; owner: unchanged) and a DOM test. Update the docs sentence that says
   everyone sees it.
5. **Docs and one SDK comment.** `docs/pipelines.md:98` "Back or a swipe takes it back with the reply" → ends
   "…until it is applied"; the same paragraph gains: a tie for a member who is only in the session's cast is
   never offered. `../serene-pub-sdk/contracts/src/outlets.ts` ~2388 still says "never applied": correct the
   comment to the rule (offered in Apply; a tie on a notes-born entry goes with the entry). Comment only.
6. **Three missing tests** in `lorebooks/applyKnowledgeTies.int.test.ts` /
   `pipelines/runtime/host.noteEntryKnowledge.int.test.ts`: the receipt sentences *…with ‹entry›; it goes to
   the lorebook when ‹entry› is applied.* and *…‹member› is in this session's cast only.*; and a tie from a
   session-only member to a lorebook entry is neither listed nor carried when that entry is applied.

Append a "Scope review and fix task" section to `plans/REPORT-kn-6-2026-11-17.md`.

## Report (under 300 words)

Per fix: what changed (file:line); the sentence(s) (★); tests and counts with log names; `tsc`; anything not
done.
