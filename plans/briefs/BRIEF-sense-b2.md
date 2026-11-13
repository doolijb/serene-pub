# BRIEF — lane `sense-b2` — Stage B: Apply in full, for what a session holds today

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then
`plans/REPORT-sense-b1-2026-11-11.md` in full (the slice this builds on, its review section, and "For the next Stage
B lanes"); `plans/DESIGN-own-book-write-path-2026-11-11.md` D5–D8, D13 and Challenger C2 (the challenger round wins
over the text above it; this brief wins over both); `plans/PLAN-sensible-engine-2026-11-11.md` §1.3, §5.8, §5.9;
CLAUDE.md Principles P1 and P3, Hard rules, "0.6 is in users' hands", the Sockets ruling; NOMENCLATURE §1, §23, §24,
§25; `STYLE-GUIDE.md` for the card you touch. `plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and
your workers word for word.

## Why this lane comes before more kinds move

Since `sense-b1`, a pipeline's change to a lorebook entry waits for a press. Under the Full write setting that is a
step backwards for ordinary play: the lorebook used to update by itself. This lane makes Apply happen by itself, show
its cause and be undoable, **before** new entries, links, members and values are moved into the own book by later
lanes. The owner's rule: seamless by default, more control by opting in.

## Rulings that bind (owner 2026-11-11)

- "Only Apply settles." "A turn owns what it wrote."
- S4: Apply happens by itself as scenes end, or waits for the lorebook's owner: **one fact per lorebook** (that
  setting itself lands when the write mode retires; see item 4).
- Stage B questions: scene end is "when the summary is saved; at close for genres that do not summarise"; a genre
  with no scenes applies at Close out only; (b) fold.
- P1: every automatic action shows its cause and how to undo it or switch it off.
- Members never see model plumbing. A session, never a chat. Every session has a lorebook.

## Rulings added 2026-11-12

- When held changes apply by themselves (owner): "At scene close, unless a summary waits" — described as: "Changes
  apply when a scene closes. If that scene's summary is being written or is waiting for your review, they apply
  when you save it instead. Default play stays seamless; a reviewed summary still gates its scene."
- A cold challenger round on this brief raised five objections; all are accepted and folded in below. Where the
  design says otherwise, this brief wins.

## Build

Begin by re-reading every cited line and listing, in your first worker brief, every caller of `applyOverlayItems`,
`overlayItemsOf`, `settleThrough`, `takeBackApply`, and every place a scene closes.

1. **Every applied item is recorded; most can be taken back.** Today a new own-book entry moved into the lorebook
   by Apply files no record (`lorebooks/ownBook.ts` ~1457–1501) and `batch` is null when only entries were applied.
   Each applied entry, and each link that moves with it, files a `lore_imprints` record with `origin: 'apply'` in
   the press's `batch`. Its `cause` stores what Apply overwrites and nothing else keeps: the entry's prior
   `lorebook_id`, `branch_id`, `position`, `anchor_binding_id`, `anchor_entry_id`. `takeBackApply` moves the entry
   and its links back, all or nothing, and **refuses in a sentence** (F8) when anything stands on it: another
   session's link to it; an amendment on it; a history day naming it; the lorebook owner's edit to it since the
   Apply; another session's name annotation resolving to it (`ref_entry_id`); another session's stat rows on it;
   a child entry anchored to it. **An applied place entry is not taken back in this lane** (`dropTurnTiesOfPlaces`
   re-files its stat rows without their turn ties): take-back of a batch holding one refuses and says so.
2. **A held change the lorebook already agrees with is done, not a conflict.** When the lorebook's resolved field
   already reads the held change's `after`, listing and Apply drop the held row. Applying the second of two held
   changes to one field must not say "has changed in the lorebook" when the cause is the session's own earlier held
   change: say what is true, or apply them in order.
3. **Apply settles; take-back does not un-settle.** After an Apply (pressed or automatic) the session settles
   through the newest anchor among the items applied, never past the message before the oldest item still held.
   Take-back restores the lorebook and the held rows and **leaves the settle line where it is**: compaction is
   one-way (`sessions/settle.ts` ~186–278), so moving the line back would let Back remove turns whose writes can no
   longer be taken. **No other settle trigger is removed or changed** (`sources`, a scene's summary done,
   `settleOnWrite`). Say plainly in the report that, while those triggers remain, the "never past a held item" cap
   holds only for Apply's own settle, and file moving the line back as a ★ for the lane that retires them.
4. **No new setting in this lane.** Automatic Apply runs for a lorebook only when the write setting in force for it
   is Full: `bookLoreWriteMode(lorebook) === 'full'` (`state/loreWriteMode.ts` ~45, the stricter of the owner's
   setting and the lorebook's own). "How to switch it off" (P1) is the existing "Writes from sessions to this book"
   picker. No column, no migration, no seed, no toggle: the one-fact-per-lorebook setting lands when the write
   mode retires.
5. **Automatic Apply.** One function, with one rule for when:
   - **a scene closes** and no summary of that scene is being written or waiting for review → apply now. Scenes
     close in `scenes/liveScenes.ts` (`openScene` closing the open scene ~1390 with `noteScene(opened:false)` ~1467;
     `closeScene` ~1542–1548): call from those sites or from `noteScene`, so the boundary watcher's closes count;
   - **that scene's summary is saved** (`summaryStatus` becomes `done`, `sockets/scenes.ts` `sceneUpdateHandler`
     ~724) → apply then; a summary a person dismisses or that fails releases the wait (apply then, or at the next
     trigger: decide, test, report);
   - **Close out** (`sockets/sessionArchive.ts` `closeOutSession`, which serves Archive and next chapter too) →
     apply before its `notRegistered` / `busy` / `nothing` early returns; only `missing` and `notOwner` stop it.
   It applies only when all hold: item 4's mode test; the session's owner is the lorebook's owner; the session is
   not a branch (`branchOfSessionId` null); the item is additive or clean. Everything else stays held with its
   reason. It runs after the triggering commit, never with the outer `db` inside another transaction, and its
   failure never fails the trigger. `cause` on its records: `{ automatic: 'scene-close' | 'scene-summary' |
   'close-out', sceneId? }`.
6. **Shown, with its undo (P1).** In the existing "This session only" card (`SessionViewPanel.svelte`):
   - a second list, what was **applied to the lorebook from this session**: one row per batch, newest first (when,
     by whom or by which automatic cause, how many changes), expandable to its items, each row with **Take back**;
     a refusal shows its sentence in place;
   - when the lorebook applies by itself, one sentence in the card says so and links to the "Writes from sessions
     to this book" picker.
   **One access rule:** both lists are readable by every member of the session, as `sessions:overlayItems` is
   today; Apply and Take back are the lorebook owner's only, and the list payload carries `mayApply` (the card's
   buttons follow it: today they are gated on the *session's* owner at `SessionsSidebar.svelte` ~1062, which the
   server then refuses). Sockets: `sessions:appliedBatches` (list) and `sessions:takeBackApply`. After any Apply or
   take-back, pressed or automatic, the server tells the session's room that the lists moved, with `sessionId` in
   the payload (an event in `SCOPED_EVENTS` without its scope key sends nothing); the one domain context for this
   event family (`client/contexts/sessionOutcomes.svelte.ts`) is the only listener that toasts.
   All copy is provisional 🚧: follow STYLE-GUIDE's copy rules and list every string in the report. Reuse the cast
   merge log's list-with-Undo pattern (`CastDuplicatesPanel.svelte` ~240–262).
7. **Docs and ledgers in the same change:** `docs/lorebooks.md` ("Bringing a session's changes into the lorebook":
   under Full, your own lorebook takes them as scenes close; how to stop that; taking back and when it refuses),
   `docs/sessions.md` (the settle sentence), `../serene-pub-sdk/guides/storage.md` (the Apply paragraph),
   NOMENCLATURE rows and §25.

## Files owned

`lorebooks/ownBook.ts` (list, Apply, take-back, the automatic function), `lorebooks/imprints.ts` (only what item 1
needs; the retraction rule must not change), `sessions/settle.ts` (item 3 only), `sockets/sessions.ts` (the overlay
sockets and the two new ones), `scenes/liveScenes.ts` (the close sites' after-commit call only),
`sockets/scenes.ts` (`sceneUpdateHandler`'s after-commit call and the summary's dismiss/fail path only),
`sockets/sessionArchive.ts` (the call and its place before the early returns), `src/lib/shared/sockets/types.ts`
and `interest.ts` (the new events), `client/contexts/sessionOutcomes.svelte.ts`, `SessionViewPanel.svelte`,
`SessionsSidebar.svelte` (the gate), tests beside each, the docs above. **No migration and no schema change.**

## Out of scope

Moving any other kind of write into the own book; the write mode, its three columns, its readers and its UI; any
new setting or toggle; removing or changing any settle trigger; moving the settle line back; book-scoped pipelines
(automatic history compile or graph build); notifications-centre entries; `state_proposals`; links, members and
values as list items of their own; a parent session listing its branches; anything in `pipelines/runtime/host.ts`
or `state/write.ts` (if you find you need either, stop and report).

## Stop and ask when

Anything needs a migration; automatic Apply would have to run inside a scene handler's transaction; a scene can
close on a path you cannot reach from the owned files; a published SDK name, port or payload would change other
than additively; take-back of an applied entry cannot be made all-or-nothing from what `cause` stores; you need
`host.ts` or `state/write.ts`.

## Done means

Tests for every numbered item, including: an applied new entry is taken back with its links and its prior
position and anchors; take-back refuses for each standing case in item 1 and for a place entry, writing nothing; a
branch's held copy of a change its original applied is dropped, not a conflict; Apply settles and Back then refuses
with the existing sentence; take-back leaves the line; automatic Apply on a scene closed by a person, by
`openScene`, and by the boundary watcher; held while a summary is running or in review, applied when it is saved,
and released when it is dismissed or fails; at Close out with nothing to close and with no close-out registration;
never for a member's session, a branch, a lorebook whose mode in force is Review or Off (at the owner's level and
at the lorebook's), or a conflicted item; a failing automatic Apply leaves the scene closed and saved; the sockets'
access rules; a second member's list refreshes after an automatic Apply. The suites the slice touched (`heldApply`,
`ownBook`, `imprints`, `settle`, `heldAmendments.*`, `sessions.retraction`, the scenes and live-scenes tests,
`closeOut`, `rewind`) pass. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean, and
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` shows no new error in the files you touched. Tests run only
inside `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run
--maxWorkers=3 …"`. SDK docs only: no `sdk:build` unless code there changed.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-b2-2026-11-11.md`): the rule as built in a few sentences a person could read, which settle triggers remain, every string of provisional
copy verbatim, changed files in each repo, tests and results, open ★, provisional names, **Noticed, not done**.
