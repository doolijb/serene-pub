# BRIEF — worker `kn-5-w1` (lane `kn-5`, part A): a hand tie always wins

App `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`. Supervisor: lane `kn-5`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You edit no compiled SDK file, so you run no `sdk:build` at all.)

Also: never `git checkout / restore / stash` in either repo; never `prettier --write`; no migration (stop and report if one seems needed); inside `db.transaction(async (tx) => …)` use only `tx`; never `pkill -f` a generic pattern; never pipe vitest into `head`.

## Goal (owner ruling D39, 2026-11-16: "A hand tie always wins over what play wrote")

Change the knowledge judge so that **a hand tie decides for its pair, whatever the other ties and their dates say**, make every screen sentence true to that, and update the docs.

### Definitions (exact; from the lane's corrected brief)

- **A hand tie** is what the code already calls one: `isHand` in `readBookKnowledge` (`src/lib/server/lorebooks/entryKnowledge.ts` ~738–741) and what `setHandKnowledgeTie` (~881–925) writes: a knowledge tie of kind `knows` or `kept_from` with `history_entry_id` NULL **and** `branch_id` NULL. Imported `knows` / `kept_from` ties that are dated or on a branch (`sockets/lorebooks.ts` ~4919–4927) are **not** hand ties. Use one predicate for this in the module (not two spellings).
- **A hand tie beats every other tie for its pair** that reads: play's kinds (`was_told`, `has_been_there`), ordinary relationships between the member and the entry (rule 1), and dated or branch `knows` / `kept_from`.
- **Two hand ties for one pair can exist** (one in the lorebook, one in a session's notes; `setHandKnowledgeTie` ends ties only in its own book): the **nearer** wins, as rule 3 already orders books (the session's notes first, then the line's steps in order: the existing `near` value), then the **newest id**. Not "most recently set".
- Among the non-hand ties the existing order stands: later date, then nearer line, then *kept from*.
- The standing-place exception (rule 5, applied in `loadEntryKnowledge` after the judge) and the not-common-knowledge mark keep their current precedence relative to ties. Full order, to be written once as a comment at `judgeEntryKnowledge` (and the module header's rule 3 updated to match):
  1. The place the speaker stands in counts as known, whatever the ties (rule 5).
  2. Of the ties that read for the pair, a hand tie wins over every other tie; of two hand ties, the nearer (the session's notes, then the line's steps), then the newest id.
  3. With no hand tie: the later date, then the nearer line, then *kept from*.
  4. The winning tie decides: *kept from* leaves the entry out, marked or not; any other tie means it is known.
  5. No tie reads: a marked entry is not known; an unmarked one is common knowledge.

## Build

1. `src/lib/server/lorebooks/entryKnowledge.ts`:
   - `KnowledgeRowRead` gains `hand: boolean` (or an equivalent you name in the report); `loadEntryKnowledge` selects `r.history_entry_id` and sets it; `readBookKnowledge` sets it from its existing `isHand`. `winningTies` / `judgeEntryKnowledge` / `beats` apply the order above. With the Timeline off, `hand` is unchanged (it is structural, not a date).
   - `readBookKnowledge`: the row's `hand` (the switch) becomes the kind of the hand tie that wins by the rule above (newest id in one book), not "*kept from* when both are live"; and the row gains **one field** (name it; proposed `overruled`) carrying the tie that would win if no hand tie stood (same shape as `winner`, timeline-aware date), present only when a hand tie wins and another tie reads for the pair; else null/absent. Compute it with the same judge (e.g. run `winningTies` over the rows without hand ties), never a second precedence.
   - Do **not** edit `knowledgeTiesOfPair`, `writeKnowledgeTie`, `endKnowledgeTie`, `setHandKnowledgeTie` behaviour. Do not touch `lorebooks/ownBook.ts`, `host.read.lorebookEntries.ts`, `tools/coreTools.ts`, `sockets/import.ts`, `sockets/lorebooks.ts` (other lanes own them).
2. `src/lib/shared/sockets/types.ts` `Sockets.EntryKnowledge.Row` (~18963): add that **one** field with a doc comment; update the `hand` comment. Nothing else in that file. Re-read the file right before editing (other lanes edit it).
3. Verify every reader goes through the judge and none re-derives precedence: the run's filter (`loadEntryKnowledge` via `host.read.lorebookEntries.ts`), core tools (through the same host read), **Known by** and **Knows** (`readBookKnowledge`), and the client (`knownByWords.ts`, `knowsPool.ts` ~76, `EntryInspector.svelte` ~97 count only `winner.kind`). Say in the report what you checked; change none of them unless one re-derives.
4. `src/lib/client/lorebooks/knowledge/knownByWords.ts`: remove every `noteOf` sentence that can no longer occur (all *‹Knows / Kept from›, but … is newer and wins.* / *…on this line wins.* / *…wins.* forms) and their tests in `knownByWords.test.ts`, `knownByList.dom.test.svelte.ts` (~166–174) and any other test asserting them. New note (★ copy, the supervisor proposes it to the owner): when a hand tie wins over an `overruled` tie **whose effect differs** (hand *Kept from* over a knowing tie; hand *Knows* over a *kept from* tie):
   `‹Kept from / Knows› stands over ‹tie›, which wins again at Default.` where ‹tie› is the existing tie words (rename `winsWords` to a neutral name such as `tieWords`): *“was told”*, *“has been there”*, *“‹relationshipType›”*, *a tie dated ‹date›*, *another “knows” tie* / *another “kept from” tie*. Example: *Kept from stands over “was told”, which wins again at Default.* When the effects agree, the existing *Changes nothing until the entry is marked not common knowledge.* logic applies unchanged. Keep the module pure.
5. The tab header line in `KnownByList.svelte` ~59 and `KnowsPool.svelte` ~188, *These are this lorebook's ties; a session's notes can hold newer ones, which win in that session.*, is no longer true (a newer play tie in the notes no longer beats a hand tie here). Replace it in both with (★ copy): *These are this lorebook's ties; a session's notes can hold newer ones, which win in that session unless a tie is set here by hand.* and update `knowsPool.dom.test.svelte.ts` ~188 and any other test pinning it.
6. Docs (re-read each file right before editing; edit only the knowledge passages):
   - `docs/lorebooks.md` §What a character knows (~116, ~125): "the later of two ties wins" → the order above in plain words (a tie you set by hand always wins; otherwise the later one; …); the Known by bullet: drop the *…is newer and wins / on this line wins / wins* sentences and "A tie you set by hand is undated, so any dated tie beats it"; say the new note; the last sentence about the session's notes as in step 5.
   - `docs/lorebook-cast.md`: only if it states precedence (check ~43).
   - `docs/pipelines.md` §What a character does not know, the **Dates and lines** bullet (~375): the order above. Nothing else in that file (another worker's part adds a paragraph later).
   - SDK `INTEGRATING.md` §1p: the rule text where it states precedence, and **remove** the line "Limit: a hand tie set later still loses to an earlier dated tie play wrote (the later date wins), until that rule is decided." (~1687–1688).
   - SDK `guides/genres-presets-and-routines.md`: rule 4 (~529) → the order above; **remove** the bullet "🚧 The limit: a hand tie set later still loses…" (~550).
   - Do **not** edit `contracts/src/outlets.ts` (its doc comment ~2395 says the same limit; it is a compiled file: list it in your report for the supervisor).
   - `NOMENCLATURE.md` (re-read right before editing; other lanes edit it): rows **known**, **hand tie** (its *Does not own* "the precedence (undated, so any dated tie that reads beats it: DISCUSS-LATER D39)" → the new rule, ruled D39 2026-11-16), **Known by** (the removed sentences, the new note, the header line), **entry knowledge door** (the row's new field), and one **§25 Change ledger** entry for this change (follow the ledger's existing format; read its last few entries first).

## Rules you work under (quoted)

- NOMENCLATURE §1 R1 "One word, one meaning." R3 "Qualify, never abbreviate to the bare noun." §24: "Grep for it first — across `src`, the SDK, and the schema." "Say what it is **not**, in the declaration, if a near-neighbour exists." "When you add or rename a term, record it in §25 Change ledger in the same change."
- STYLE-GUIDE §10: "Sentence case everywhere." "Help is one sentence." "errors say what went wrong and what to do."
- CLAUDE.md P1: "every automatic action shows its cause and how to undo or switch it off." P2: "A module owns its data and every write to it."
- CLAUDE.md Decisions: copy a user sees and any new name is ★: use the words given above; if you need any other new sentence or name, stop and say so in your report instead of inventing it.

## Files owned

`src/lib/server/lorebooks/entryKnowledge.ts`; `src/lib/shared/sockets/types.ts` (the one field and the `hand` comment only); `src/lib/client/lorebooks/knowledge/` (`knownByWords.ts`, `KnownByList.svelte`, `KnowsPool.svelte` header line only); their tests (`lorebooks/entryKnowledge.test.ts`, `entryKnowledge.int.test.ts`, `entryKnowledge.door.int.test.ts`, `sockets/entryKnowledge.int.test.ts`, `pipelines/runtime/bindings.entryKnowledge.int.test.ts`, `bindings.entryKnowledge.reads.int.test.ts`, the `knowledge/` tests, `client/lorebooks/entryWorkspace.knowledge.dom.test.svelte.ts`, `client/lorebooks/cast/memberKnows.dom.test.ts`); the docs listed in step 6.

## Files readable

Everything. Notably `plans/REPORT-kn-4a1-2026-11-16.md`, `plans/REPORT-kn-4a2-2026-11-16.md`, `plans/REPORT-kn-4b-2026-11-16.md`, `src/lib/shared/lorebooks/lineReading.ts`.

## Out of scope

Part C (ties in Apply); the outlet `noteEntryKnowledge` and its refusal (unchanged); `host.loreWrites.ts`; the Pipelines panel (another worker); any SDK source file.

## Stop and ask when

CLAUDE.md §Decisions applies; a name or sentence beyond the ones above is needed; a prompt baseline changes (see Tests); a migration seems needed.

## Tests (Done means)

Add to `lorebooks/entryKnowledge.test.ts` a judge table: hand vs play, each hand kind against each play kind, the play tie dated and undated, both orders of writing (ids both ways); hand vs an ordinary tie; hand vs a dated / branch `knows` / `kept_from`; two hand ties (notes vs lorebook: notes win; same book: newest id); play vs play by date (unchanged); the mark and no tie (unchanged); Timeline off. One case each that `readBookKnowledge` (door) and `loadEntryKnowledge` (the run's filter) agree with the judge on a hand *Kept from* plus a later dated *was told*. `overruled` filled and null cases. `knownByWords` cases for the new note and removed sentences.

Run, one at a time, each preceded by `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, from the app root:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-5-w1-<n>.log 2>&1"`
1. the unit/dom files you touched; 2. the int files you touched; 3. the two prompt baselines, which must pass unchanged (no shipped data has a hand tie): `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts` and `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts`. Read each log's summary (`tail -n 40`). Do not run `tsc` or `npm run check` (the supervisor runs them).

## Report (your final message)

Changed files; the precedence as built (the comment's text); readers checked; the field's name; sentences removed and added; tests run with pass counts and log paths; anything for the supervisor (the SDK `outlets.ts` comment; anything outside your files); **Noticed, not done**. Under about 400 words.
