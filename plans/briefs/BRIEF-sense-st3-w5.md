# BRIEF — lane `sense-st3`, worker 5 — docs and ledgers for ST3

You are a `lane-worker` under the `sense-st3` supervisor. Repos: `/home/jody/github/serene-pub` and the SDK at
`/home/jody/github/serene-pub-sdk`. Use absolute paths. **Docs only: change no code.**

## What was built (the facts to write; verify each against the code before you write it)

- Core's runtime values left the `core` annex document for four nullable jsonb columns on `sessions`
  (`db/schema.ts`, the comment above `turnOrder`): `turn_order` (writer `writeTurnOrder`), `turn_tally`
  (`writeLaneTally` / `writeTurnTally`; Back replays it), `lane_reads` (`markLaneRead`), `ruleset_decks` (the
  ruleset resolver). Never sent to a client. Turn order and read marks are bookkeeping: never recorded, never taken.
  Owner ruling (2026-11-11, verbatim): "Move to columns (Recommended)" — "The annex becomes purely the modders'
  home … Ruleset decks follow Back; turn order and read marks do not."
- A new table, **`session_imprints`** 🚧 (provisional name: the owner has been shown it and has not ruled it — mark
  it 🚧 everywhere and say "provisional name"), `sessions/sessionImprints.ts`: one change a turn made to a session
  row, kept so it can be taken back; the sibling of `lore_imprints`; kinds `seat-bench`, `ruleset-conversion`,
  `deck`, `annex`; one row per write; anchored to the turn's message; `standing` / `settled`. The one retraction
  rule is `retractionAct` (`lorebooks/imprints.ts`), shared by both tables; a session row is always reverted (like
  the session's own notes). A seat a person already set the other way is left, and its row dropped.
- **Draws are taken now.** Every draw files a `deck` row anchored to the turn (`turnAnchorOf`, in every mode,
  propose included), so a swipe, a regenerate, Back and a delete take it and Forward puts it back. **When two turns
  draw from one deck and the earlier is taken, the earlier turn's cards stay spent**: the later card was dealt from
  the position the earlier draw left (the rule's splice); taking the later afterwards puts the deck where it stood
  before both.
- **The annex changes per key.** An annex write files one `annex` row per changed key (with the key's audience
  before/after and the owner's version); `annex_deltas` is gone (migration `0155_chubby_lockjaw`, with a data
  upgrade). `keepOnRetell` is now "a replacement skips that key's rows": the key keeps its value on a swipe,
  regenerate or failed run, and goes when the turn leaves. A failed re-tell keeps none of its own annex values. A
  branch's annex is the annex as of the fork, folded per key.
- **A branch is the session as of the fork** for these too: the parent's later imprints are folded back onto the
  decks, the ruleset version and the seat bench flags; the turn tally's story lane is replayed over the branch's
  history; turn order and read marks copy as they stand; the parent's imprints up to the fork are copied with the
  branch's message and seat ids.
- The settle line marks session imprints settled as it marks lore imprints (`before` gone; Back cannot take them).
- The Session data panel lists declared fields and genuinely undeclared keys only (the runtime keys are no longer in
  the document).
- Deleted names (for NOMENCLATURE): `coreAnnexIn`, `coreAnnexKeySql`, `coreAnnexSetSql`, `annexForPipelines`,
  `ownerDocForPipelines`, `recordAnnexDelta`, `retractAnnexDeltasAnchoredTo`, `restoreAnnexDeltas`,
  `AnnexDeltaTaken`, `retractSeatBenchesAnchoredTo`, `SeatBenchRecord`, `RulesetConversionRecord`, the core annex
  keys `rulesetConversions` / `seatBenches` as homes, the table `annex_deltas` (`AnnexDeltaSide` stays ⏳ only to
  read an old `rewind_taken` record). New names: `session_imprints` / `sessionImprints` 🚧, `SESSION_IMPRINT_KINDS`,
  `fileSessionImprint`, `retractSessionImprints`, `restoreSessionImprints`, `settleSessionImprints`,
  `sessionImprintsAfter`, `sessionImprintsFromOldRecord`, `copySessionImprintsToBranch`, `standingSeatBenches`,
  `seatBenchKey`, `annexImprintKey`, `retractionAct`, `isTimelessAnnexKey`, the seat-keys store `annex_imprints`
  (was `annex_deltas`), `RetractedState.sessionImprints` / `.imprintMark`. `CORE_RUNTIME_KEYS` stays, now only the
  list the data upgrade and readers of old snapshots strip.

## What to edit

1. `../serene-pub-sdk/guides/storage.md`: the table at ~41–50 stays true (check it); ~82 "Draws are not anchored to
   a turn yet, and neither case takes them." becomes the truth above, including the two-turns sentence; ~352
   `keepOnRetell` says a replacement skips that key's changes (it keeps its value) and Back or a delete take them.
   Plain, short sentences in the guide's voice. No internal table or function names a plugin author cannot use.
2. `../serene-pub-sdk/INTEGRATING.md` ~1008–1035 (wherever the turn order is said to live in the core annex) and
   ~1434 (seat benches recorded "in the core annex"): correct to the columns and the session imprints.
3. `docs/sessions.md`: grep for annex, Back, Forward, swipe, deck, draw, Session data, branch, turn order; correct
   only what ST3 changed (draws now taken; the annex changes per key; a branch as of the fork for decks, version and
   benches).
4. `docs/rulesets.md`: if it describes decks or draws, say a draw goes with its turn (swipe, regenerate, Back,
   delete) and the two-turns rule.
5. `NOMENCLATURE.md` (read §1, §23, §24, §25 first, and the row format around lines 1750–1800):
   - a new row **session imprint** 🚧 beside **lore imprint** (~1753) with its charter (P6: purpose, why it exists,
     what it owns and what it does not, who does) and "provisional name, unruled";
   - the **lore imprint** row: the rule is `retractionAct`, shared with session imprints;
   - the **core runtime keys** row (~1795): now columns on `sessions`, one writer each; what was deleted;
   - **annex delta** (~1773): retired → move it to §23 Retired words with why (replaced by per-key `annex` session
     imprints, 2026-11-11, lane sense-st3);
   - the rows for **annex** and **deck** (find them: the annex row in §9 or the pr-6 table; a deck / card-draw /
     `DeckState` row wherever it is): one clause each for what changed;
   - §25 Change ledger: one entry for this change (old → new, lane `sense-st3`, 2026-11-11), in the ledger's format.
6. If `src/lib/generated/docs/` is generated from the SDK guides, say how it is regenerated and whether it needs it;
   do not regenerate it unless that is a plain documented command. Then: `pgrep -af "vite dev"`; if no serene-pub
   dev server is up, run `npm run sdk:build` once from `/home/jody/github/serene-pub` and report whether the
   `coreCatalog` digest moved (it should not; docs only). If one is up, don't build; report 'blocked on your dev
   server'. **Do not re-pin anything.**

## Files owned

`../serene-pub-sdk/guides/storage.md`, `../serene-pub-sdk/INTEGRATING.md`, `docs/sessions.md`, `docs/rulesets.md`,
`NOMENCLATURE.md`.

## Out of scope

Any code or test; any doc beyond these five; the Clear button; `annex-changed`'s payload.

## Stop and ask (in your report) when

A doc would need a new user-facing name; a sentence you would write is not true in the code.

## Rules (verbatim; they bind you)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an
  overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** If a fact above turns out false in the code, report it and
  do not write it.
- NOMENCLATURE headlines: R1 one word, one meaning · R2 distinctive words for new concepts · R3 qualify, never the
  bare noun · R4 casual words are not type names · R5 reconcile vocabularies at boundaries · R6 mark ⏳
  transitional / 🚧 provisional vocabulary. "When you add or rename a term, record it in §25 Change ledger in the
  same change." §23: never reintroduce a retired word.
- Another session is editing this repo (visual-novel layout work: dialogue-box widget, `show-line`, portraits) and
  may be editing NOMENCLATURE or docs too: edit only the rows and lines you need, re-read right before each edit.

## Done means

The five files edited as above; `sdk:build` run once (or blocked) with the digest reported.

## Report

Return as your final message: each change (file, section, before → after in one line), the new and moved
NOMENCLATURE rows, every provisional (🚧) word and sentence you wrote, the `sdk:build` result, **Noticed, not
done**.
