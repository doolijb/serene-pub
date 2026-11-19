# BRIEF — build lane `kn-5` — three knowledge rulings: a hand tie wins, one switch per pipeline, play's ties in Apply (owner rulings D39, D36, D41)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then rows D36, D39,
D41 (and D40, D43, D45 for context) in `plans/DISCUSS-LATER.md`, `plans/REPORT-kn-2a-2026-11-16.md`,
`-kn-4a1-…`, `-kn-4a2-…`, `-kn-4b-2026-11-16.md`, `plans/INVENTORY-knowledge-screens-2026-11-16.md`,
`docs/lorebook-cast.md` / `docs/lorebooks.md` (knowledge), `docs/pipelines.md`, `NOMENCLATURE.md` §1, §24 and
the knowledge rows (~959–965), `../serene-pub-sdk/INTEGRATING.md` §1p.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root; `sdk:build` only from the app root after checking no dev / preview server (`pgrep -af "vite"`;
the Svelte language server's esbuild does not count) and no vitest is up. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-5-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. **No migration** (stop and report if
one is needed). Inside `db.transaction` only `tx`. No full run, no `npm run build`. Other lanes running:
`tl-4` (`sockets/import.ts`, `lorebooks/ownBook.ts` **inserts only**, `host.read.lorebookEntries.ts` history
rows, SDK Dungeon Crawler files) and `lb-1` (lorebook delete paths): do not edit their parts; re-read any file
right before editing; coordinate SDK builds by the wait loop.

## Owner (2026-11-16, rulings page)

D39: "A hand tie always wins over what play wrote". D36: "One switch for the pipeline's lore reads, under
Advanced". D41: "Offer it in Apply". Earlier (2026-11-15): hand kinds **Knows** and **Kept from**; play's rows
show their own reason; "Yes everyone by default."; P1 (every automatic action shows its cause and how to undo
it), P2 (the module that owns the data owns every write).

## Build

### A. A hand tie always wins (D39)

`judgeEntryKnowledge` (`src/lib/server/lorebooks/entryKnowledge.ts` ~161–176) picks one tie per cast member and
entry: the later date wins and a dated tie beats an undated hand tie. New rule: **an active hand tie (`knows`
or `kept_from`) decides, whatever play's ties say and whatever their dates**; among play's own ties
(`was_told`, `has_been_there`) the order by date stands; with two active hand ties for one pair (should not
exist: check the write path) the most recently set wins. The standing-place exception and the entry's
not-common-knowledge mark keep their current precedence relative to ties: state the full order in one comment
at the function and in the docs. Every reader goes through the judge (the run's filter, core tools, the
**Known by** tab, the **Knows** tab): verify none re-derives it. The tab's sentence *Kept from, but ‹reason› is
newer and wins.* can no longer occur: remove it and its test; the row for a pair with both now says, in the
existing style, that the hand tie stands and play's reason is kept beneath it (sentence ★). The SDK outlet's
write-time refusal when a hand tie exists (`kn-4b`) stays; remove the documented limit "a hand tie set later
still loses to an earlier dated play tie" from `INTEGRATING.md` and the guide.

### B. One knowledge switch per pipeline in the panel (D36)

Today the Pipelines panel derives a `knownToSpeaker` control on every read (about eight on Story's reply).
Build: **one shared control for the pipeline's lore reads, under Advanced**, the way the seven scan settings
are already shared across the lore lanes (find that mechanism in `pipelines/config/panel/` and reuse it; no
new mechanism): label *Only what the speaker knows* with its one sentence of purpose; writing it sets the
param on every read of that pipeline that declares it; a spec whose reads disagree shows the shared control's
existing "mixed" treatment (if the shared mechanism has none, show the value of the owner lane and say so in
the report). A modder still sets it per query in the spec; nothing changes in the SDK contract or at run time.
Re-pin the panel tests lane `fnd-4` just pinned (`pipelines/boot/lorebookTriggerControls.int.test.ts`,
`retrievalModeCull.int.test.ts`, `config/panel/index.int.test.ts` `LANE_OWN` and the relaxed label check from
D36: restore the strict check), old → new in the report.

### C. A tie play writes while the lorebook is not on Full is offered in Apply (D41)

Today (`kn-4b`): on Full the tie goes to the lorebook; otherwise it is written to the session's notes and is
**never applied** (`lorebooks/ownBook.ts` ~1598: overlay links exclude knowledge ties). Build: such a tie is a
row in the same Apply / Take back review as play's other held changes, worded by its reason (*‹member› was
told ‹entry›* / *‹member› has been to ‹entry›*, in the review's existing sentence style: ★); **Apply** writes
it to the lorebook through `writeKnowledgeTie` (the module that owns the data: no SQL in the review code),
subject to the same rules as a direct write: refused, in words on the row, when an active hand tie exists for
the pair in the lorebook (rule A) or the member / entry no longer exists there; **Take back** removes it from
the notes. Until applied it keeps working as that session's own knowledge, as today. Back / a swipe that
removes the reply still removes the tie (imprints), applied or not: test both. A shared lorebook the session's
owner does not own: follow what the review already does for links there. If the overlay's storage cannot mark
a tie as "held, offered" without a migration, stop and report with the smallest schema proposal.

### D. Docs and names

`docs/lorebooks.md` / `docs/lorebook-cast.md` (the precedence order; Apply now lists what characters came to
know), `docs/pipelines.md` (the one switch), `INTEGRATING.md` §1p and the SDK guide's knowledge section
(routing: "offered in Apply"; the removed limit), `NOMENCLATURE.md` rows and §25.

## Tests

A: the judge's table (hand vs play, each kind, dated and undated, both orders of writing; play vs play by date;
mark and standing place unchanged); each reader agrees; prompts for the shipped worlds unchanged (both
baselines: no shipped data has a hand tie). B: the panel shows one control under Advanced for each shipped
pipeline with lore reads; a write reaches every read; the run reads it. C: held → shown in Apply → applied to
the lorebook → known in another session on that lorebook; refused under a hand tie; Take back; Back / swipe.
SDK: `sdk:build`; `npm run sdk:test` (capped) only the four known failures. `tsc` 0; `npm run check` 0 errors
in lane files.

## Files owned

`lorebooks/entryKnowledge.ts`, the knowledge client under `src/lib/client/lorebooks/knowledge/` (the one
sentence), `pipelines/config/panel/` (the shared control), `lorebooks/ownBook.ts` (**the overlay's review of
ties only**), the Apply review's client rows, `host.loreWrites.ts` `noteEntryKnowledgeWrite` (routing words
only), their tests, the SDK docs / guide, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; a migration is needed for C; the shared-control mechanism cannot carry a boolean
param; rule A changes a prompt baseline.

## Report

Final message = the report (lead saves `plans/REPORT-kn-5-<date>.md`): A the full precedence order as built; B
where the control sits and the tests re-pinned (old → new); C the review row, Apply and its refusals; sentences
and names (★); **Noticed, not done**. Under about 650 words.

## Cold review corrections (2026-11-16) — these rule over the text above

**Part C (ties in Apply) is cut out into lane `kn-6`, briefed separately after this lane and `tl-4` land: do
not build it, do not edit `lorebooks/ownBook.ts`.** This lane is A, B and their docs.

### A, corrected
- **A hand tie is what the code already calls one:** `isHand` (`entryKnowledge.ts` ~765–768;
  `setHandKnowledgeTie` ~897–911): kind `knows` or `kept_from`, undated, on the main line. Imported ties of
  those kinds that are dated or on a branch (`sockets/lorebooks.ts` ~4919–4927) are **not** hand ties.
- **A hand tie beats every other tie for its pair:** play's kinds, ordinary ties between the member and the
  entry (rule 1, ~21–23: "play later links them" is in the owner's question), and dated or branch
  `knows` / `kept_from`.
- **Two hand ties for one pair can exist** (one in the lorebook, one in a session's notes:
  `setHandKnowledgeTie` ends ties only in its own book and `findOwnedBook` accepts a session's notes,
  `utils/ownedBook.ts` 53–54): the **nearer** wins, as rule 3 already orders books (the session's notes, then
  the line's steps), then the newest id. Not "most recently set".
- Remove every `winsWords` sentence that can no longer occur (`client/lorebooks/knowledge/knownByWords.ts`),
  with their tests. Showing play's reason beneath a winning hand tie needs a field on
  `Sockets.EntryKnowledge.Row` (`src/lib/shared/sockets/types.ts` ~18968): that file is owned by this lane for
  that one field.

### B, replaced: one control that writes every read, not the scan-settings mechanism
The scan settings are shared through a `shared: true` field flag in the SDK contract and the spec's `ofNode`
wiring to an owner lane (`contracts/src/queries.ts` 1013–1057; `config/panel/declarations.ts` 904–934): the run
reads the owner lane's value. `knownToSpeaker` is declared on eight query definitions (`queries.ts` 856, 1081,
1626, 1810, 2001, 2299, 2694, 4155) and only the three lore lanes are wired to an owner, so reusing that
mechanism would change the contract and the run and silently override a modder's per-query value. **Do not
mark it `shared`. No SDK contract change, no run-time change.** Build, in the panel only:
- one derived control per pipeline, *Only what the speaker knows*, shown in place of the per-read controls for
  that param; reading it shows the common value of every read in the pipeline that declares the param, or, when
  they differ (a modder's spec), the words *Set differently on ‹n› of this pipeline's reads* (★) with the
  switch showing the value most reads hold;
- writing it writes **each read's own stored address** (the same addresses the per-read controls wrote), so
  the run, the one store, locks and the session layer behave exactly as before;
- where it sits: Advanced is grouped per step (`config/panel/types.ts` 393, 455), so place it in the Advanced
  group of the step that owns the lore lanes (the one the scan settings sit on), with its one sentence saying
  it covers every lore read of this pipeline (★ placement and sentence); a pipeline with knowledge-filtered
  reads and no lore-lane owner shows it on the first such read's step;
- the per-read controls for this param are no longer derived (the strict label check D36 relaxed is restored);
  the session settings form, if it shows this param anywhere, follows the same one control.
This is a small panel mechanism ("a control that fans out to several addresses"): keep it private to the
panel, name it by §24, record it in NOMENCLATURE §25 as 🚧, and report it as ★ so the owner sees a new
internal mechanism was needed for his "one switch".

Stop and ask (replaces the brief's B stop): the panel cannot write several addresses in one change atomically;
locks differ between the reads of one pipeline.
