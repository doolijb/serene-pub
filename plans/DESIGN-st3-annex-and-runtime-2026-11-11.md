# DESIGN — ST3: the annex holds declared fields only; one change record for session rows

Status: **draft for a challenger round, 2026-11-11.** Built only after the round. Parent: `plans/PLAN-sensible-engine-2026-11-11.md`
§1.5, §1.6, the ST3 row in §1.7, ★S6 (ruled 2026-11-11: "Move to columns"; "Ruleset decks follow Back; turn order and
read marks do not"), and `sense-st2`'s ★ST2-2 (draws are anchored to no turn).

## What is true today (inventory 2026-11-11; every line re-read by the lead or cited by the inventory)

- A session's annex is `sessions.annex` jsonb, `{ owner: document }`, with `annex_audiences` and `annex_versions`
  beside it (`db/schema.ts:2663-2686`).
- Core keeps six **runtime keys** inside the `core` owner's document (`sessions/coreAnnex.ts:53-62`): `turnOrder`,
  `turnTally`, `laneReads`, `rulesetDecks`, `rulesetConversions`, `seatBenches`. They are stripped from every pipeline
  read (`coreAnnex.ts:114-136`) and exempt from the annex undo by a `TIMELESS` list (`sessions/annexChanges.ts:66-85`).
- `annex_deltas` (`schema.ts:3387-3416`) stores the **whole owner document**, before and after, per write. For `core`
  that snapshot carries the runtime keys; only `withTimeless` stops Back, Forward and a branch's `annexAt` from
  reviving stale ones.
- `rulesetConversions` and `seatBenches` are **undo logs stored inside the annex they are exempt from**, hand-edited in
  `state/write.ts:941-958, 1128-1157, 1422-1461` and `messages/store.ts:635-640`. `turnTally` has its own Back path
  (`sessions/rewind.ts:660, 673, 770`). `rulesetDecks` (`rulesets/resolve.ts:221-252`) has no per-draw record at all:
  Back, swipe and regenerate do nothing to it.
- `lore_imprints` (`schema.ts:10729-10776`, `lorebooks/imprints.ts`) is the per-field record for lorebook rows: one row
  per field, `before`/`after` wrapped `{v}`, retraction newest first with a splice when a later writer of the same
  field stands. `lorebook_id` is NOT NULL and its subject kinds are a CHECK, so it cannot hold session-row changes.
- The Session data panel (`SessionAnnexPanel.svelte`, `sessions/annexInspect.ts:107-138`) shows the runtime keys as
  "legacy" rows. It has no Clear.

## The design, in two lanes

### ST3a — runtime values leave the annex

1. **Four columns on `sessions`**, each nullable jsonb, holding exactly what the key holds today: `turn_order`,
   `turn_tally`, `lane_reads`, `ruleset_decks`. One generated migration. Their one writer each stays the module that
   writes the key today (`turnOrder.ts`, `turnTally.ts`, `attention.ts`, `rulesets/resolve.ts`).
2. **One new table for changes a turn makes to session rows**, the sibling of `lore_imprints` with the same shape and
   the same retraction rule. Proposed name `session_imprints` (NOMENCLATURE §24: an *imprint* is already "a change a
   run left on a row, kept so it can be taken back"; R3 qualifies it). Columns: `id`, `session_id` (cascade),
   `message_id` (nullable int, as `lore_imprints`), `run_id`, `subject_kind` (CHECK: `seat-bench`, `ruleset-conversion`,
   `deck`, and in ST3b `annex`), `subject_key` text, `before`, `after` (`{v}`), `created_at`. In ST3a it takes over:
   - `seatBenches` → kind `seat-bench`, key `<kind>:<seatId>`, before/after the benched boolean;
   - `rulesetConversions` → kind `ruleset-conversion`, key the ruleset id, before/after `{ from, to }`;
   - **draws** → kind `deck`, key the deck's method key, before/after the `DeckState`. Written where
     `rulesets/resolve.ts:239-252` merges `out.decks`, anchored like every other write of the resolving turn. This is
     what makes decks follow Back, swipe and regenerate (★ST2-2, S6).
3. `retractStateAnchoredTo` takes these rows by the imprints' rule instead of editing JSON logs; `RetractedState` keeps
   carrying what Forward needs. `turnTally` keeps its replay path. `turnOrder` and `laneReads` are bookkeeping: never
   recorded, never taken.
4. **`TIMELESS` shrinks to `retake-quietly`; the pipeline strip (`annexForPipelines`) goes**, since nothing of core's
   own is left in the document to hide. `CORE_RUNTIME_KEYS` stays only as the list the boot pass and the readers of old
   snapshots strip.
5. **Stored data** (0.6 is in users' hands): a data upgrade moves each key out of every session's `annex.core` into its
   column or into `session_imprints` rows, then removes the key. Old `annex_deltas` rows and old `rewind_taken` JSON
   still carry runtime keys inside whole-document snapshots: every reader of a snapshot (`landOwner`, `annexAt`,
   `restoreAnnexDeltas`, the revive in `write.ts:1191-1237`) drops `CORE_RUNTIME_KEYS` from the document it lands, so a
   stale copy can never come back. A second boot changes nothing.
6. **A branch** copies the four columns as they stand and copies `session_imprints` rows up to the fork with message ids
   remapped, by the same map the branch already builds for messages. (Today the logs are copied unmapped inside the
   annex: `sessions/branch.ts:174`.)
7. The Session data panel then lists declared fields and genuinely undeclared keys only.

### ST3b — annex changes per key

1. An annex write files one `session_imprints` row per changed key: kind `annex`, key `<owner>/<key>`, before/after
   `{v}`, plus the audience before/after for that key. `annex_deltas` stops being written.
2. Retraction is the imprints' rule per key. `keepOnRetell` becomes "skip that key's rows on a replacement": the
   narrowing of a whole-document row in place, `kept`, `except` and the failed-re-tell special case all go.
3. `annexAt` (a branch's annex as of the fork) folds per-key rows instead of whole documents.
4. A data upgrade converts each `annex_deltas` row into per-key rows by diffing its `before` and `after`
   (runtime keys skipped); `rewind_taken` JSON written by older versions is converted the same way when it is revived.
   Then `annex_deltas` is dropped by a generated migration.
5. `annex-changed` can name the keys that changed. The Session data panel gains Clear per owner (G1.6), which files
   imprints like any write so Back takes it back.

## What this deliberately does not do

- It does not change where a session's annex lives, or the annex's published API. `storage.md:43-46, 352-353, 382`
  stay true; `storage.md:82` (draws are not taken) and `INTEGRATING.md:1008, 1434` (turn order and seat benches "in
  the core annex") are corrected.
- It does not touch `lore_imprints`, the lorebook annex, the user annex, the settle line's rule, or what a branch
  inherits beyond item 6.
- No new setting. No new published name except what `annex-changed` gains in ST3b, if built.

## Questions for the challenger

1. Is a sibling table right, or should `lore_imprints` be widened (nullable `lorebook_id`, wider CHECK)? Plan §1.6
   left this open.
2. Are four jsonb columns right, or does `turn_tally` (which has a Back path of its own) belong in the change record?
3. Is the old-snapshot rule (strip on read, never rewrite old rows) safe for `rewind_taken` and for the settle delete
   (`sessions/settle.ts:266-270`)?
4. Should ST3a and ST3b be one lane and one migration?
5. Deck draws: is one imprint per deck per turn enough, or does a turn that draws twice from one deck need two?

---

## Challenger round (2026-11-11) — five objections, all accepted. The design as amended:

Status: **GO for one lane, two build steps, one migration.**

1. **Never to a client.** `turn_order`, `turn_tally`, `lane_reads`, `ruleset_decks` join the excluded columns at
   `sockets/sessions.ts:441` and `:2079` (today `annex`, `annexAudiences`, `drafts`), with a test that neither
   `sessions:list` nor `sessions:get` carries them. Read marks are every member's; a deck's state lets a player work
   out the next card.
2. **Every reader and writer moves, and the compiler lists them.** `coreAnnexIn`, `coreAnnexKeySql` and
   `coreAnnexSetSql` are **deleted**, not kept, so no site can silently read nothing. Known sites beyond the first
   inventory: `sessions/seatKeys.ts:776-790`, `:1233-1258`, `:1520-1521` (the boot pass and the fold-time rekey must
   read and write `turn_order` / `turn_tally`), `sessions/convertRuleset.ts:248-253`, `runtime/host.ts:9389-9410`,
   `sockets/sessions.ts:5760-5772` ("fell in story": reads the newest standing `seat-bench` row), `:10817`,
   `yourMove.ts:55`, `turnOrderPush.ts:43`, `settings.ts:216`, `turnPlan.ts:376`, `moments.ts:219`, `evaluate.ts:295`,
   `publishedValues.ts:184`, `resolve.ts:634`, `rewind.ts:660`, `:835`, `attention.ts:83`.
3. **A branch is the session as of the fork (plan §1.9 F1, Rule 3).** The parent's session imprints after the fork
   are folded backwards onto `ruleset_decks`, `ruleset_version` and the seat bench flags, as `annexAt` does for the
   annex; `turn_tally` is replayed on the branch (`retallyStoryLane`), not copied; seat ids inside bench keys are
   remapped with the branch's seat maps as message ids are. `turn_order` and `lane_reads` copy as they stand. The F1
   test: a branch cut before a draw, a bench and a conversion sees none of them.
4. **Old `rewind_taken` survives the upgrade.** A revive step turns an old record's `seatBenches` and `conversions`
   into session imprint rows, so "Back before the upgrade, Forward after" restores them. (Noticed: today
   `reviveRetractedState` drops `conversions`; only `rewind.ts:741` puts them back.)
5. **The record's shape.** The table has `status` (`standing` / `settled`); the settle line marks its rows settled
   exactly as it marks lore imprints (`settle.ts:256-265`). Session rows take the imprints' **always revert** branch,
   like a session's own notes. `annex` rows keep `owner_version`, which Forward needs to migrate a document whose
   owner was upgraded since (`annexChanges.ts:331-341`). **Clear is not built in this lane**: a person's own press
   writes as the person and files no imprint (Rule 1; NOMENCLATURE:1752); the button is a UI proposal for later.

Answers taken: a **sibling table**, with **one retraction function shared** by both tables, so the rule exists once.
`turn_tally` as a column replays correctly. Strip-on-read is safe for whole-document deltas and unnecessary once the
upgrade converts them, so it is not built: **one migration** (`annex` in the CHECK from the start) and the upgrade
converts `annex_deltas` per key in the same lane, runtime keys skipped. **Draws:** one row per write, not per turn;
anchored with `turnAnchorOf` in every mode, propose included (`rulesets/resolve.ts:1052-1058`), or a regenerated
propose turn spends twice. When two turns draw from one deck and the earlier is taken, the earlier turn's cards stay
spent: the later card was dealt from the position the earlier draw left (plan §1.9 F8). The guide says so.
